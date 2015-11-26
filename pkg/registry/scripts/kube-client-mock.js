/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

(function() {
    var kube_last = 100;

    var kube_data = { };
    var handlers = [ ];

    function add_notify(handler) {
        handlers.push(handler);
    }

    function remove_notify(handler) {
        var i, len = handlers.length;
        for (i = 0; i < len; i++) {
            if (handlers[i] === handler)
                handlers[i] = null;
        }
    }

    function dispatch_notify() {
        var i, len = handlers.length;
        for (i = 0; i < len; i++) {
            if (handlers[i])
                handlers[i].apply(kube_data, arguments);
        }
    }

    function guid() {
        function s4() {
            return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
        }
        return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
               s4() + '-' + s4() + s4() + s4();
    }

    function deparam(query) {
      var parsed = { };
      var vars = query.split("&");
      for (var i = 0; i < vars.length; i++) {
          var pair = vars[i].split("=");
          var k = decodeURIComponent(pair[0]);
          var v = decodeURIComponent(pair[1]);
          if (typeof parsed[k] === "undefined" ||
              typeof parsed[k] === "function") {
              if (k.substr(k.length - 2) != '[]')
                  parsed[k] = v;
              else
                  parsed[k] = [v];
          } else if (typeof parsed[k] === "string") {
              parsed[k] = v;
          } else {
              parsed[k].push(v);
          }
      }

      return parsed;
    }

    function kube_apiserver(req, defer) {
        var path;
        var query;

        var pos = req.path.indexOf('?');
        if (pos === -1) {
            path = req.path;
            query = { };
        } else {
            path = req.path.substring(0, pos);
            query = deparam(req.path.substring(pos + 1));
        }

        var parts = path.substring(1).split("/");

        /* The API check */
        if (parts.length == 1 && (parts[0] == "api" || parts[0] != "oapi")) {
            req.mock_respond(200, "OK", { }, JSON.stringify({
                versions: [ "v1" ]
            }));
        }

        if (parts[0] != "api" && parts[0] != "oapi" && parts[1] != "v1") {
            req.mock_respond(404, "Not API");
            return;
        }

        var base_uri = "/" + parts.slice(0, 2).join("/");
        parts = parts.slice(2);

        var ret = false;
        if (req.method === "POST") {
            ret = kube_api_post(req, parts, query, base_uri);
        } else if (req.method === "GET") {
            ret = kube_api_get(req, parts, query, base_uri);
        } else if (req.method === "DELETE") {
            ret = kube_api_delete(req, parts, query, base_uri);
        }  else {
            req.mock_respond(405, "Unsupported method");
            ret = true;
        }

        if (!ret)
            req.mock_respond(404, "Not found");
    }

    function kube_update(key, object) {
        var type;
        if (!object) {
            if (kube_data[key]) {
                type = "DELETED";
                object = kube_data[key];
                delete kube_data[key];
            } else {
                return null;
            }
        } else {
            if (kube_data[key])
                type = "MODIFIED";
            else
                type = "ADDED";
            kube_data[key] = object;
        }

        if (!object.metadata)
            object.metadata = { };
        if (!object.metadata.uid)
            object.metadata.uid = guid();
        object.metadata.resourceVersion = kube_last;
        kube_last += 1;

        dispatch_notify(type, key, object);
        return object;
    }

    function kube_api_get(req, parts, query, base_uri) {
        var resourceVersion = null;
        var namespace_re = ".+";

        /* Figure out if this is a watch */
        var watch = false;
        if (query.hasOwnProperty("watch")) {
            watch = true;
            if (query.resourceVersion) {
                resourceVersion = parseInt(query.resourceVersion, 10);
                if (isNaN(resourceVersion))
                    throw "invalid resourceVersion";
            }
        }

        /* Figure out if namespace api was used */
        var what = parts.shift();
        if (what == "namespaces" && parts.length > 1) {
            namespace_re = parts.shift();
            what = parts.shift();
        }

        var specific = parts.join("/");
        var kind = null;
        var regexp = null;

        function prepare(key, object) {
            if (resourceVersion) {
                if (!object.metadata || !object.metadata.resourceVersion ||
                    object.metadata.resourceVersion < resourceVersion)
                    return null;
            }
            if (specific) {
                if (key != specific)
                    return null;
            }
            if (regexp) {
                if (!key.match(regexp))
                    return null;
            }

            var copy = JSON.parse(JSON.stringify(object));
            copy.metadata.selfLink = base_uri + "/" + key;
            copy.apiVersion = "v1";
            return copy;
        }

        /* Various lists */
        if (what == "namespaces") {
            regexp = /namespaces\/[a-z0-9-_]+$/;
            kind = "NamespaceList";
        } else if (what == "nodes") {
            regexp = /nodes\//;
            kind = "NodeList";
        } else if (what == "pods") {
            regexp = RegExp("namespaces/"+ namespace_re +"/pods/");
            kind = "PodList";
        } else if (what == "services") {
            regexp = RegExp("namespaces/"+ namespace_re +"/services/");
            kind = "ServiceList";
        } else if (what == "replicationcontrollers") {
            regexp = RegExp("namespaces/"+ namespace_re +"/replicationcontrollers/");
            kind = "ReplicationControllerList";
        } else if (what == "events") {
            regexp = RegExp("namespaces/"+ namespace_re +"/events/");
            kind = "EventList";
        } else if (what == "images") {
            req.mock_respond(404, "OK", { "Content-Type": "text/plain; charset=utf-8" });
            return;
        } else if (what == "imagestreams") {
            regexp = RegExp("namespaces/"+ namespace_re +"/imagestreams/");
            kind = "ImageStreamList";
        /* Nothing found */
        } else {
            return false;
        }

        function respond_get() {
            var items = [ ];
            var result = {
                kind: kind,
                creationTimestamp: null,
                items: items
            };

            angular.forEach(kube_data, function(value, key) {
                var object = prepare(key, value);
                if (object)
                    items.push(object);
            });

            req.mock_respond(200, "OK", { "Content-Type": "application/json" }, JSON.stringify(result));
            return true;
        }

        function respond_watch() {
            req.mock_respond(200, "OK", { "Content-Type": "text/plain; charset=utf-8" }, null);

            var body = "";
            angular.forEach(kube_data, function(value, key) {
                var object = prepare(key, value);
                if (object)
                    body += JSON.stringify({ type: "ADDED", object: object }) + "\n";
            });

            function stream_watch(type, key, value) {
                var object = prepare(key, value);
                if (object)
                    req.mock_data(JSON.stringify({ type: type, object: object }) + "\n", true);
            }

            add_notify(stream_watch);
            req.mock_data(body, true);

            window.setTimeout(function() {
                remove_notify(stream_watch);
                req.mock_data("", false);
            }, 5000);

            return true;
        }

        if (watch)
            return respond_watch();
        else
            return respond_get();
    }

    function kube_api_post(req, parts, query, base_uri) {
        var namespace;
        var section;

        if (parts.length === 3) {
            if (parts[0] != "namespaces")
                return false;
            namespace = parts[1];
            section = parts[2];
        } else if (parts.length === 1) {
            section = parts[0];
        } else {
            return false;
        }

        var object;
        try {
            object = JSON.parse(req.body);
        } catch(ex) {
            req.mock_respond(400, "Bad JSON");
            return true;
        }

        var kind = object.kind;
        var meta = object.metadata || { };
        var name = meta.name;

        if (!kind || !meta || !name) {
            req.mock_respond(400, "Bad fields in JSON");
            return true;
        }

        if (kind.toLowerCase() + "s" != section) {
            req.mock_respond(400, "Bad section of URI");
            return true;
        }

        parts.push(name);
        var key = parts.join("/");

        if (kube_data[key]) {
            req.mock_respond(409, "Already exists", { "Content-Type": "application/json" },
                             JSON.stringify({ code: 409, message: "Already exists" }));
            return true;
        }

        kube_update(key, object);
        req.mock_respond(200, "OK", { "Content-Type": "application/json" }, JSON.stringify(object));
        return true;
    }

    function kube_api_delete(req, parts, query, base_uri) {
        var namespace;
        var kind;
        var name;

        if (parts.length === 4) {
            if (parts[0] != "namespaces")
                return false;
            namespace = parts[1];
            kind = parts[2];
            name = parts[3];
        } else if (parts.length === 2) {
            namespace = parts[1];
        } else {
            return false;
        }

        var key = parts.join("/");

        var resp = kube_update(key, null);
        req.mock_respond(200, "OK", { "Content-Type": "application/json" }, JSON.stringify(resp));
        return true;
    }

    angular.module("kubeClient.mock", [
        "kubeClient",
    ])

    .value("MockKubeData", {
        load: function load(data) {
            kube_data = JSON.parse(JSON.stringify(data));
        },
        update: kube_update
    })

    .factory("MockKubeWatch", [
        "$q",
        "KUBE_SCHEMA",
        "MockKubeRequest",
        function($q, KUBE_SCHEMA, MockKubeRequest) {
            return function CockpitKubeWatch(path, callback) {
                var defer = $q.defer();
                var promise = defer.promise;

                unique += 1;

                var request = new MockKubeRequest("GET", path + "?watch=true", "", {
                    streamer: handle_stream,
                    unique: unique,
                });

                var buffer;
                function handle_stream(data, response) {
                    if (buffer)
                        data = buffer + data;

                    var lines = data.split("\n");
                    var i, length = lines.length - 1;

                    /* Last line is incomplete save for later */
                    buffer = lines[length];

                    /* Process all the others */
                    var frame, frames = [];
                    for (i = 0; i < length; i++) {
                        frame = JSON.parse(lines[i]);
                        if (!frame.object)
                            throw "invalid watch without object";

                        /* The watch failed, likely due to invalid resourceVersion */
                        if (frame.type == "ERROR")
                            throw frame;

                        frames.push(frame);
                    }

                    callback(frames);

                    var df = defer;
                    if (df) {
                        callback([]);
                        defer = null;
                        df.resolve(response);
                    }
                }

                request.then(function(response) {
                    var df = defer;
                    defer = null;
                    if (df)
                        df.resolve(response);
                }, function(response) {
                    var df = defer;
                    defer = null;
                    if (df)
                        df.reject(response);
                });

                promise.cancel = function cancel() {
                    var df = defer;
                    if (request)
                        request.cancel();
                    if (df) {
                        defer = null;
                        df.reject({
                            status: 999,
                            statusText: "Cancelled",
                            problem: "cancelled",
                        });
                    }
                };
                return promise;
            };
        }
    ])

    .factory("MockKubeRequest", [
        "$q",
        function($q) {
            return function MockKubeRequest(method, path, data, config) {
                var req = angular.extend({ }, config, { method: method, path: path, body: data });
                var defer = $q.defer();
                var promise = defer.promise;
                var response;
                function finish() {
                    var df = defer;
                    defer = null;
                    if (response.headers["Content-Type"] == "application/json")
                        response.data = JSON.parse(response.data);
                    if (response.status < 300)
                        df.resolve(response);
                    else
                        df.reject(response);
                }

                req.mock_respond = function(status, reason, headers, body) {
                    if (!defer)
                        return;
                    response = {
                        status: status,
                        statusText: reason,
                        headers: headers || { },
                        data: "",
                        unique: req.unique,
                    };
                    if (body !== null)
                        req.mock_data(body || "", false);
                };

                req.mock_data = function(body, stream) {
                    if (!defer)
                        return;
                    if (typeof (body) !== "string")
                        body = JSON.stringify(body);
                    if (req.streamer)
                        req.streamer(body, response);
                    else
                        response.data += body;
                    if (!stream)
                        finish();
                };

                promise.cancel = function cancel() {
                    if (!defer)
                        return;
                    defer.reject({
                        status: 999,
                        statusText: "Cancelled",
                        problem: "cancelled",
                    });
                    defer = null;
                };

                kube_apiserver(req);
                return promise;
            };
        }
    ]);

    var unique = 0;

}());

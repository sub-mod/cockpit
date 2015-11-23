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
    "use strict";

    /*
     * Some notes on the create fields.
     *
     * Namespaces should be created first, as they must exist before objects in
     * them are created.
     *
     * Services should be created before pods (or replication controllers that
     * make pods. This is because of the environment variables that pods get
     * when they want to access a service.
     *
     * Create pods before replication controllers ... corner case, but keeps
     * things sane.
     */

    var KUBE = "/api/v1";
    var OPENSHIFT = "/oapi/v1";
    var DEFAULT = { api: KUBE, create: 0 };
    var SCHEMA = flat_schema([
        { kind: "Group", type: "groups", api: OPENSHIFT },
        { kind: "Image", type: "images", api: OPENSHIFT, global: true },
        { kind: "ImageStream", type: "imagestreams", api: OPENSHIFT },
        { kind: "Namespace", type: "namespaces", api: KUBE, global: true, create: -100 },
        { kind: "Node", type: "nodes", api: KUBE, global: true },
        { kind: "Pod", type: "pods", api: KUBE, create: -20 },
        { kind: "PolicyBinding", type: "policybindings", api: OPENSHIFT, global: true},
        { kind: "Project", type: "projects", api: OPENSHIFT, global: true, create: -90    },
        { kind: "ReplicationController", type: "replicationcontrollers", api: KUBE, create: -60 },
        { kind: "Service", type: "services", api: KUBE, create: -80 },
        { kind: "User", type: "users", api: OPENSHIFT, global: true },
    ]);

    function debug() {
        if (window.debugging == "all" || window.debugging == "kube")
            console.debug.apply(console, arguments);
    }

    function hash(str) {
        var h, i, chr, len;
        if (str.length === 0)
            return 0;
        for (h = 0, i = 0, len = str.length; i < len; i++) {
            chr = str.charCodeAt(i);
            h = ((h << 5) - h) + chr;
            h |= 0; // Convert to 32bit integer
        }
        return Math.abs(h);
    }

    function search(arr, val) {
        var low = 0;
        var high = arr.length - 1;
        var mid, v;

        while (low <= high) {
            mid = (low + high) / 2 | 0;
            v = arr[mid];
            if (v < val)
                low = mid + 1;
            else if (v > val)
                high = mid - 1;
            else
                return mid; /* key found */
        }
        return low;
    }

    /**
     * HashIndex
     *
     * A probablisting hash index, where items are added with
     * various keys, and probable matches are returned. Similar
     * to bloom filters, false positives are possible, but never
     * false negatives.
     */
    function HashIndex(size) {
        var self = this;
        var array = [];

        self.add = function add(keys, value) {
            var i, j, p, x, length = keys.length;
            for (j = 0; j < length; j++) {
                i = hash("" + keys[j]) % size;
                p = array[i];
                if (p === undefined)
                    p = array[i] = [];
                x = search(p, value);
                if (p[x] != value)
                    p.splice(x, 0, value);
            }
        };

        self.all = function all(keys) {
            var i, j, p, result, n;
            var rl, rv, pv, ri, px;

            for (j = 0, n = keys.length; j < n; j++) {
                i = hash("" + keys[j]) % size;
                p = array[i];

                /* No match for this key, short cut out */
                if (!p) {
                    result = [];
                    break;
                }

                /* First key */
                if (!result) {
                    result = p.slice();

                /* Calculate intersection */
                } else {
                    for (ri = 0, px = 0, rl = result.length; ri < rl; ) {
                        rv = result[ri];
                        pv = p[ri + px];
                        if (pv < rv) {
                            px += 1;
                        } else if (rv !== pv) {
                            result.splice(ri, 1);
                            rl -= 1;
                        } else {
                            ri += 1;
                        }
                    }
                }
            }

            return result || [];
        };
    }

    function flat_schema(items) {
        var i, len, ret = { "": DEFAULT };
        for (i = 0, len = items.length; i < len; i++) {
            ret[items[i].type] = items[i];
            ret[items[i].kind] = items[i];
        }
        return ret;
    }

    /*
     * Accepts:
     *  1. an object
     *  2. an involved object
     *  2. a path string
     *  3. type/kind, name, namespace
     */
    function resource_path(args) {
        var one = args[0];
        if (one && typeof one === "object") {
            if (one.name && one.kind) {
                /* An involved object */
                args = [ one.kind, one.name, one.namespace ];

            } else if (one.metadata) {
                /* An object with a link */
                if (one.metadata.selfLink)
                    return one.metadata.selfLink;

                /* Pull out the arguments */
                args = [ one.kind, one.metadata.name, one.metadata.namespace ];
            }

        /* Already a path */
        } else if (one && one[0] == '/') {
            return one;
        }

        /* Combine into a path */
        var schema = SCHEMA[args[0]] || SCHEMA[""];
        var path = schema.api;
        if (!schema.global && args[2])
            path += "/namespaces/" + encodeURIComponent(args[2]);
        path += "/" + schema.type;
        if (args[1])
            path += "/" + encodeURIComponent(args[1]);
        return path;
    }

    /*
     * Angular definitions start here
     */

    angular.module("kubeClient", [])

    /**
     * KUBE_SCHEMA
     *
     * A dict of schema information. The keys are both object types
     * and resource kinds. The values are objects with the following
     * properties:
     *
     *  schema.kind    The object kind
     *  schema.type    The resource type (ie: used in urls)
     *  schema.api     The api endpoint to use
     *  schema.global  Set to true if resource is not namespaced.
     */

    .value("KUBE_SCHEMA", SCHEMA)

    /**
     * kubeLoader
     *
     * Loads kubernetes objects either by watching them or loading
     * objects explicitly. The loaded objects are available at
     * the .objects property, although you probably want to
     * use kubeSelect() to interact with these objects.
     *
     * loader.handle(objects, [removed])
     *
     * Tell the loader about a objects that has been loaded
     * or removed elsewhere.
     *
     * loader.listen(callback)
     *
     * Register a callback to be invoked some time after new
     * objects have been loaded. Returns an object with a
     * .cancel() method, that can be used to stop listening.
     *
     * promise = loader.load(path)
     * promise = loader.load(involvedObject)
     * promise = loader.load(resource)
     * promise = loader.load(kind, name, namespace)
     *
     * Load the resource at the path. Returns a promise that will
     * resolve with the resource or an array of objects at the
     * given path.
     *
     * ns = loader.namespace()
     *
     * Return the current namespace that watches are limited to
     * or null if watching all namespaces.
     *
     * loader.namespace("value")
     *
     * Change the namespace that watches are limited to. Specify a
     * value of null to watch all namespaces. This will clear out
     * all loaded objects, and start all watches again.
     *
     * loader.reset([total])
     *
     * Clear out all loaded objects, and clear all watches. If
     * the total flag is set, won't restart the watches, but
     * clear all the loaded state.
     *
     * loader.objects
     *
     * A dict of all loaded objects.
     *
     * promise = loader.watch(type)
     *
     * Start watching the given resource type. The returned promise
     * will be resolved when an initial set of objects have been
     * loaded for the watch, or rejected if the watch has failed.
     *
     */

    .factory("kubeLoader", [
        "$q",
        "$exceptionHandler",
        "KubeWatch",
        "KubeRequest",
        "KUBE_SCHEMA",
        function($q, $exceptionHandler, KubeWatch, KubeRequest, KUBE_SCHEMA) {
            var callbacks = [];
            var only_namespace = null;

            /* All the current watches */
            var watches = { };

            /* All the loaded objects */
            var objects = { };

            /* Timeout batching */
            var batch = null;
            var batch_timeout = null;

            /* Stuff we're going to pull */
            var pulls = { };
            var pulling = null;

            function create_watch(type) {
                var path = resource_path([type, "", only_namespace]);
                watches[type] = new KubeWatch(path, handle_frames);
            }

            function handle_frames(frames) {
                if (batch === null)
                    batch = frames;
                else
                    batch.push.apply(batch, frames);

                /* When called with empty data, flush, don't wait */
                if (frames.length > 0) {
                    if (batch_timeout === null)
                        batch_timeout = window.setTimeout(handle_timeout, 150);
                    else
                        return; /* called again later */
                }

                handle_flush();
            }

            function handle_flush() {
                var drain = batch;
                batch = null;

                if (!drain)
                    return;

                var present = { };
                var removed = { };
                var i, len, frame, link, resource, meta;

                for (i = 0, len = drain.length; i < len; i++) {
                    resource = drain[i].object;
                    if (resource) {
                        meta = resource.metadata || { };
                        link = meta.selfLink;
                        if (drain[i].type == "DELETED") {
                            delete objects[link];
                            removed[link] = resource;
                        } else {
                            present[link] = resource;
                            objects[link] = resource;
                        }
                    }
                }

                /* Run all the listeners and then digest */
                invoke_callbacks(present, removed);
            }

            function invoke_callbacks(/* ... */) {
                var i, len, func;
                for (i = 0, len = callbacks.length; i < len; i++) {
                    func = callbacks[i];
                    try {
                        if (func)
                            func.apply(self, arguments);
                    } catch (e) {
                        $exceptionHandler(e);
                    }
                }
            }

            function handle_timeout() {
                batch_timeout = null;
                handle_flush();
            }

            function reset_loader(total) {
                var link, type;

                /* We drop any batched objects in flight */
                window.clearTimeout(batch_timeout);
                batch_timeout = null;
                batch = null;

                pulls = { };
                if (pulling)
                    pulling.cancel();

                /* Clear out everything */
                for (link in objects)
                    delete objects[link];

                /* Tell the callbacks we're resetting */
                invoke_callbacks();

                /* Create all the watches again */
                for (type in watches) {
                    if (watches[type])
                        watches[type].cancel();
                    watches[type] = null;
                }
                if (total) {
                    watches = { };
                    only_namespace = null;
                } else {
                    for (type in watches)
                        create_watch(type);
                }
            }

            function handle_objects(objects, removed, kind) {
                handle_frames(objects.map(function(resource) {
                    if (kind)
                        resource.kind = kind;
                    return {
                        type: removed ? "DELETED" : "ADDED",
                        object: resource
                    };
                }));
                handle_flush();
            }

            function pull_queue(involved) {
                var key = involved.kind + ":" + involved.uid;
                pulls[key] = involved;
                if (!pulling)
                    pull_step();
            }

            function pull_step() {
                var ikey, involved = null;
                for (ikey in pulls) {
                    involved = pulls[ikey];
                    break;
                }

                if (!involved)
                    return;

                /* Only pull stuff involvedObjects we're interested in */
                var schema = KUBE_SCHEMA[involved.kind];
                if (!schema || !(schema.type in watches)) {
                    pull_step(); /* next one */
                    return;
                }

                var link = resource_path([involved.kind, involved.name, involved.namespace]);
                var meta, object = objects[link];
                if (object) {
                    meta = object.metadata;
                    if (meta.uid == involved.uid && involved.resourceVersion < meta.resourceVersion) {
                        pull_step(); /* next one */
                        return;
                    }
                }

                pulling = load_objects(link);
                $q.when(pulling, function() {
                    pulling = null;
                    pull_step();
                }, function(response) {
                    var object;
                    pulling = null;
                    if (response.status == 404) {
                        object = objects[link];
                        if (object)
                            handle_objects([object], true);
                    }
                    pull_step();
                });
            }

            function load_objects(/* ... */) {
                var path = resource_path(arguments);
                var req = new KubeRequest("GET", path);
                var promise = req.then(function(response) {
                    req = null;
                    var resource = response.data;
                    if (!resource || !resource.kind) {
                        return null;
                    } else if (resource.kind.indexOf("List") === resource.kind.length - 4) {
                        handle_objects(resource.items, false, resource.kind.slice(0, -4));
                        return resource.items;
                    } else {
                        handle_objects(resource);
                        return resource;
                    }
                }, function(response) {
                    req = null;
                    throw response;
                });
                promise.cancel = function cancel(ex) {
                    req.cancel(ex);
                };
                return promise;
            }

            var self = {
                watch: function watch(type) {
                    if (!(type in watches))
                        create_watch(type);
                    return watches[type];
                },
                load: function load(/* ... */) {
                    return load_objects.apply(this, arguments);
                },
                namespace: function namespace(value) {
                    if (value !== undefined) {
                        only_namespace = value;
                        reset_loader();
                    }
                    return only_namespace;
                },
                reset: function reset(total) {
                    reset_loader(total);
                },
                listen: function listen(callback, before) {
                    if (before)
                        callbacks.unshift(callback);
                    else
                        callbacks.push(callback);
                    return {
                        cancel: function() {
                            var i, len;
                            for (i = 0, len = callbacks.length; i < len; i++) {
                                if (callbacks[i] === callback)
                                    callbacks[i] = null;
                            }
                        }
                    };
                },
                handle: function handle(objects, removed) {
                    if (!angular.isArray(objects))
                        objects = [ objects ];
                    handle_objects(objects, removed);
                },
                objects: objects,
            };

            return self;
        }
    ])

    /**
     * kubeSelect
     *
     * Allows selecting loaded objects based on various criteria. The
     * goal here is to allow selection to be fast enough that it can be
     * done repeatedly and regularly, without keeping caches of objects
     * all over the place.
     *
     * Resources may be filtered in a chain by calling various filter
     * functions. Lets start with an example that finds a pod:
     *
     *   pod = kubeSelect()
     *      .kind("Pod")
     *      .namespace("default")
     *      .name("docker-registry")
     *      .one();
     *
     * Calling kubeSelect() will return a dict with all loaded objects,
     * containing unique keys, and then various filters can be called to
     * further narrow results.
     *
     * The following filters are available by default:
     *
     *  .kind(kind)       Limit to specified kind
     *  .namespace(ns)    Limit to specified namespace
     *  .name(name)       Limit to this name
     *  .label(selector)  Limit to objects whose label match selector
     *
     * Additional filters can be registered by calling the function:
     *
     *   kubeSelect.register(filter)
     *
     * Ask on FreeNode #cockpit for documentation on filters.
     */

    .factory("kubeSelect", [
        "kubeLoader",
        function(loader) {
            /* A list of all registered filters */
            var filters = { };

            /* A hash index */
            var index = null;

            /* The filter prototype for functions available on selector */
            var proto = null;

            /* A cache of the everything selection */
            var everything = null;

            loader.listen(function(present, removed) {
                everything = null;

                /* Get called like this when reset */
                if (!present)
                    index = null;

                /* Called like this when more objects arrive */
                else if (index)
                    index_objects(present);
            }, true);

            /* Create a new index and populate */
            function index_create() {
                /* TODO: Derive this value from cluster size */
                index = new HashIndex(262139);
                index_objects(loader.objects);
            }

            /* Populate index for the given objects and current filters */
            function index_objects(objects) {
                var link, object, name;
                for (link in objects) {
                    object = objects[link];
                    for (name in filters)
                        index.add(filters[name].keys(object), link);
                }
            }

            function make_prototype_call(filter) {
                return function() {
                    return filter.filter(this, arguments);
                };
            }

            function make_prototype(length) {
                var name, ret = { };
                for (name in filters) {
                    ret[name] = {
                        enumerable: false,
                        configurable: true,
                        value: make_prototype_call(filters[name])
                    };
                }
                return ret;
            }

            function mixin_selection(results, length) {
                var link;
                if (length === undefined) {
                    length = 0;
                    for (link in results)
                        length += 1;
                }
                proto = proto || make_prototype();
                Object.defineProperties(results, proto);
                Object.defineProperties(results, {
                    _data: {
                        enumerable: false,
                        configurable: true,
                        value: { }
                    },
                    length: {
                        enumerable: false,
                        configurable: true,
                        value: length
                    }
                });
                return results;
            }

            function default_filter(what, args) {
                /* jshint validthis: true */
                var filter = this;
                var criteria = filter.criteria.apply(filter, args);

                /* Fast path, already calculated results */
                var desc = filter.name + ": " + JSON.stringify(criteria);
                var results = what._data[desc];
                if (results)
                    return results;

                /* Digest down to possible matches */
                var possible, keys = filter.keys(criteria);
                if (keys.length) {
                    if (!index)
                        index_create();
                    possible = index.all(keys);
                } else {
                    possible = Object.keys(what);
                }

                results = { };

                var i, len, object, link, count = 0;
                for (i = 0, len = possible.length; i < len; i++) {
                    link = possible[i];
                    object = what[link];
                    if (object && filter.match(object, criteria)) {
                        results[link] = object;
                        count += 1;
                    }
                }

                results = mixin_selection(results, count);

                /* In case we get called again */
                what._data[desc] = results;
                return results;
            }

            function register_filter(filter) {
                filters[filter.name] = filter;
                if (!filter.filter)
                    filter.filter = default_filter;
                index = null;
                proto = null;
            }

            /* The one filter */
            register_filter({
                name: "one",
                keys: function() {
                    return [];
                },
                filter: function(what, args) {
                    var link;
                    for (link in what)
                        return what[link];
                    return null;
                }
            });

            /* The label filter */
            register_filter({
                name: "label",
                keys: function(object) {
                    var labels = (object.metadata || { }).labels || [];
                    var i, ret = [];
                    for (i in labels)
                        ret.push(i + "=" + labels[i]);
                    return ret;
                },
                match: function(object, criteria) {
                    var i, labels = (object.metadata || { }).labels || [];
                    var selector = criteria.metadata.labels;
                    var ret = false;
                    for (i in selector) {
                        if (labels[i] !== selector[i]) {
                            ret = false;
                            break;
                        }
                        ret = true;
                    }
                    return ret;
                },
                criteria: function(selector) {
                    return { metadata: { labels: selector } };
                }
            });

            /* The namespace filter */
            register_filter({
                name: "namespace",
                keys: function(object) {
                    var meta = object.metadata || [];
                    return meta.namespace ? [ meta.namespace ] : [];
                },
                match: function(object, criteria) {
                    var meta = object.metadata || [];
                    return meta.namespace === criteria.metadata.namespace;
                },
                criteria: function(namespace) {
                    return { metadata: { namespace: namespace } };
                }
            });

            /* The name filter */
            register_filter({
                name: "name",
                keys: function(object) {
                    var meta = object.metadata || [];
                    return meta.name ? [ meta.name ] : [];
                },
                match: function(object, criteria) {
                    var meta = object.metadata || [];
                    return meta.name === criteria.metadata.name;
                },
                criteria: function(name) {
                    return { metadata: { name: name } };
                }
            });

            /* The kind filter */
            register_filter({
                name: "kind",
                keys: function(object) {
                    return [ object.kind ];
                },
                match: function(object, criteria) {
                    return object.kind === criteria.kind;
                },
                criteria: function(kind) {
                    return { kind: kind };
                }
            });

            function select() {
                if (!everything)
                    everything = mixin_selection(loader.objects);
                return everything;
            }

            /* A seldom used 'static' method */
            select.register = register_filter;

            return select;
        }
    ])

    /**
     * kubeMethods
     *
     * Methods that operate on kubernetes objects.
     *
     * promise = methods.create(objects, namespace)
     *
     * Create the given resource or objects in the specified namespace.
     *
     * promise = methods.remove(resource)
     * promise = methods.remove(path)
     * promise = methods.remove(type, name, namespace)
     *
     * Delete the given resource from kubernetes.
     */
    .factory("kubeMethods", [
        "$q",
        "KUBE_SCHEMA",
        "KubeRequest",
        "kubeLoader",
        function($q, KUBE_SCHEMA, KubeRequest, loader) {
            function create_compare(a, b) {
                var sa = KUBE_SCHEMA[a.kind].create || 0;
                var sb = KUBE_SCHEMA[b.kind].create || 0;
                return sa - sb;
            }

            function create_objects(objects, namespace) {
                var defer = $q.defer();
                var promise = defer.promise;
                var request = null;

                if (!angular.isArray(objects)) {
                    if (objects.kind == "List")
                        objects = objects.items;
                    else
                        objects = [ objects ];
                }

                var have_ns = false;

                objects.forEach(function(resource) {
                    var meta = resource.metadata;
                    if (resource.kind == "Namespace" && meta && meta.name === namespace)
                        have_ns = true;
                });

                /* Shallow copy of the array, we modify it below */
                objects = objects.slice();

                /* Create the namespace if it exists */
                if (namespace && !have_ns) {
                    objects.unshift({
                        apiVersion : "v1",
                        kind : "Namespace",
                        metadata : { name: namespace }
                    });
                }

                /* Now sort the array with create preference */
                objects.sort(create_compare);

                function step() {
                    var resource = objects.shift();
                    if (!resource) {
                        defer.resolve();
                        return;
                    }

                    var path = resource_path([resource.kind, null, namespace || "default"]);
                    request = new KubeRequest("POST", path, JSON.stringify(resource))
                        .then(function post_resolved(response) {
                            debug("created resource:", path, response.data);
                            if (response.data.kind)
                                loader.handle(response.data);
                            step();
                        }, function post_rejected(response) {
                            var resp = response.data;

                            /* Ignore failures creating the namespace if it already exists */
                            if (resource.kind == "Namespace" && resp && resp.code === 409) {
                                debug("skipping namespace creation");
                                step();
                            } else {
                                debug("create failed:", path, resp || response);
                                defer.reject(response);
                            }
                        });
                }

                step();

                promise.cancel = function cancel() {
                    if (request)
                        request.cancel();
                };
                return promise;
            }

            function remove_resource(/* ... */) {
                var path = resource_path(arguments);
                var resource = loader.objects[path];
                var promise = new KubeRequest("DELETE", path);
                return promise.then(function() {
                    if (resource)
                        loader.handle(resource, true);
                });
            }

            return {
                create: create_objects,
                remove: remove_resource
            };
        }
    ])

    /**
     * KubeRequest
     *
     * Create a new low level kubernetes request. These are instantiated
     * by kubeLoader or kubeMethods, and typically not used directly.
     *
     * An implementation of KubeRequest must be provided. It has the
     * following characteristics.
     *
     * promise = KubeRequest(method, path, [body, [config]])
     *
     * Creates a new request, for the given HTTP method and path. If body
     * is present it will be sent as the request body. If it an object or
     * array it will be encoded as JSON before being sent.
     *
     * If present the config object may include the following properties:
     *
     *  headers    An dict of headers to include
     *
     * In addition the config object can include implementation specific
     * settings or data.
     *
     * If successful the promise will resolve with a response object that
     * includes the following:
     *
     * status      Status code
     * statusText  Status reason or message
     * data        Response body, JSON decoded if response is json
     * headers     Response headers
     *
     * Implementation specific fields may also be present
     */

    .provider("KubeRequest", [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeRequestFactory = null;

            function load(injector, name) {
                if (!name)
                    throw "no KubeRequestFactory set";
                else if (angular.isString(name))
                    return injector.get(name, "KubeRequest");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeRequestFactory);
                }
            ];
        }
    ])

    /**
     * KubeWatch
     *
     * Create a new low level kubernetes watch. These are instantiated
     * by kubeLoader, and typically not used directly.
     *
     * An implementation of the KubeWatch must be provided. It has the
     * following characteristics:
     *
     * promise = KubeWatch(path, callback)
     *
     * The watch is given two arguments. The first is the kube resource
     * url to watch (without query string) a callback to invoke with
     * watch frames.
     *
     * The watch returns a deferred promise which will resolve when the initial
     * set of items has loaded, it will fail if the watch fails. The promise
     * should also have a promise.cancel() method which is invoked when the
     * watch should be stopped.
     *
     * callback(frames)
     *
     * The callback is invoked with an array of kubernetes watch frames that
     * look like: { type: "ADDED", object: { ... } }
     */

    .provider("KubeWatch", [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeWatchFactory = null;

            function load(injector, name) {
                if (!name)
                    throw "no KubeWatchFactory set";
                else if (angular.isString(name))
                    return injector.get(name, "KubeWatch");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeWatchFactory);
                }
            ];
        }
    ]);

}());

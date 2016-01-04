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

    angular.module('openshift.projects', [
        'ngRoute',
        'ui.cockpit',
        'kubeClient'
    ])

    .config(['$routeProvider',
        function($routeProvider) {
            $routeProvider.when('/projects', {
                templateUrl: 'views/projects-page.html',
                controller: 'ProjectsCtrl',
                reloadOnSearch: false,
            });
        }
    ])

    .factory("projectsLoader", [
        "kubeLoader",
        function(loader) {

            /* Called when we have to load images via imagestreams */
            function handle_namespaces() {
                loader.watch("namespaces").catch(function(response) {
                    loader.listen(handle_namespace);
                });
            }

            function handle_namespace(imagestream) {
                var meta = imagestream.metadata || { };
                var status = imagestream.status || { };
                angular.forEach(status.tags || [ ], function(tag) {
                    angular.forEach(tag.items || [ ], function(item) {
                        var link = loader.resolve("Image", item.image);
                        if (link in loader.objects)
                            return;

                        /* An interim object while we're loading */
                        var interim = { kind: "Image", apiVersion: "v1", metadata: { name: item.image } };
                        loader.handle(interim);

                        var name = meta.name + "@" + item.image;
                        loader.load("ImageStreamImage", name, meta.namespace).then(function(resource) {
                            var image = resource.image;
                            if (image) {
                                image.kind = "Image";
                                loader.handle(image);
                            }
                        }, function(response) {
                            console.warn("couldn't load image: " + response.statusText);
                            interim.metadata.resourceVersion = "invalid";
                        });
                    });
                });
            }

            return {
                watch: function() {
                    loader.watch("projects").catch(function(response) {
                        loader.listen(handle_namespaces());
                    });
                    
                }
            };
        }
    ])

      .directive('debug', function () {
        var defaultType = "json";

        return {
          scope: {
            value: '=debug'
          },
          templateUrl: function (tElement, tAttrs) {
            var type = tAttrs['type'] || defaultType;
            var tpl;
            switch (type) {
              case "json":
                //tpl = '<pre ng-bind="value | json"></pre>';
                tpl = "./json.html";
                break;
              case "type":
                tpl = '<pre>Type: {{value | type}}</pre>';
                break;
              case "array":
                var innerType = tAttrs['innerType'] || defaultType;
                tpl = '<div ng-repeat="el in value" debug="el" type="' + innerType + '">{{el}}</div>';
                break;
              case "full":
                tpl = '<div debug="value" type="type"></div><div debug="value" type="json"></div>';
                break;
              default:
                tpl = '<b>Unknown debug type "' + type + '" for</b><pre>{{value}}</pre>';
                break;
            }
            return tpl;
          }
        };
      })
    .controller('AddUserDialogCtrl', [
        '$q',
        '$scope',
        "kubeMethods",
        function($q, $scope, kubeMethods) {
            var user_json = {
              "kind": "User",
              "apiVersion": "v1",
              "metadata": {
                "name": null
              },
            };
            var namespace = "default";

            $scope.addUser = function(user_name) {
                user_json.metadata.name = user_name;
                var defer = $q.defer();
                defer.reject(new Error("This is a global failure message"));
                
                var promise = kubeMethods.create(user_json, namespace)
                    .then(function(data) {
                        console.log('My first promise succeeded', data);
                            $scope.bigError = new Error("This is a global failure message");
                            defer.reject(new Error("This is a global failure message"));
                        }, function(error) {
                            console.log('My first promise failed', error);
                            $scope.bigError = new Error("This is a global failure message");
                            defer.reject();
                        });
                return promise;
            };
        }
    ])
    .controller('ProjectsCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        '$modal',
        function($scope, loader, select, $modal) {
            $scope.addProjectDialog = function() {
                $modal.open({
                    controller: 'AddUserDialogCtrl',
                    templateUrl: 'views/projects/add-user-dialog.html',
                    resolve: {
                        exampleData: function() {
                            return [1, 2, 3];
                        }
                    },
                }).result.then(function(response) {
                    console.log("dialog response", response);
                }, function(reject) {
                    console.log("dialog reject", reject);
                });
            };

            loader.watch(["users"]);
            loader.watch(["groups"]);
            loader.watch(["policybindings"]);
            loader.watch(["projects"]);
            loader.load("projects", null, null);
            /* nothing here yet */
            $scope.users = function() {
                return select().kind("User");
            };

            $scope.groups = function() {
                return select().kind("Group");
            };

            $scope.policybindings = function() {
                return select().kind("PolicyBinding");
            };

            $scope.projects = function() {
                return select().kind("Project");
            };

            $scope.formatMembers = function format_members(members, kind) {
                var mlist = "";
                if (!members)
                    return mlist;
                if (members.length <= 1) {
                    for (var i = members.length - 1; i >= 0; i--) {
                        mlist += members[i] + ",";
                    }
                } else {
                    if (kind === "Groups") {
                        mlist = members.length + " " + kind;
                    } else if (kind === "Users") {
                        mlist = members.length + " " + kind;
                    }
                }
                return mlist;
            };
        }
    ]);
}());

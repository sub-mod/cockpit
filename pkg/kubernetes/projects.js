define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "kubernetes/client",
    "kubernetes/app"
], function($, cockpit, angular, kubernetes) {
    'use strict';

    var _ = cockpit.gettext;

    return angular.module('kubernetes.projects', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/projects', {
                templateUrl: 'views/projects-page.html',
                controller: 'ProjectsCtrl'
            });
        }])

        /*
         * The controller for the projects view.
         */
        .controller('ProjectsCtrl', [
            '$scope',
            'kubernetesClient',
            function($scope, client) {

                client.include("users");
                client.include("groups");
                client.include("policybindings");

                var lists = {
                    Namespace: null,
                    User: null,
                    Group: null,
                    PolicyBinding: null
                };

                Object.keys(lists).forEach(function(kind) {
                    lists[kind] = client.select(kind);
                    client.track(lists[kind]);
                    $(lists[kind]).on("changed", function() {
                        $scope.$digest();
                    });
                });

                angular.extend($scope, {
                    projects: lists.Namespace,
                    users: lists.User,
                    groups: lists.Group,
                    policybindings: lists.PolicyBinding
                });

                $scope.$on("$destroy", function() {
                    angular.forEach(lists, function(list) {
                        client.track(list, false);
                    });
                });


                var name_list = {
                    usernames: null,
                    groupnames: null
                };

/*                $scope.get_all_members = function get_all_members() {
                    name_list.usernames = [];
                    name_list.groupnames = [];

                    if (lists.Group) {
                        $.each( $scope.groups, function(index,value){
                            console.log("Index = " + index + " value = " + value.metadata.name);
                            name_list.groupnames.push(value.metadata.name);
                            if (value.users) {
                                console.log("users = "+value.users);
                                var userl = String(value.users).split(",");
                                for (var i = userl.length - 1; i >= 0; i--) {
                                    name_list.usernames.push(userl[i]);
                                };
                            }
                        });
                    }
                    if (lists.User) {
                        $.each( $scope.users, function(index,value){
                            console.log("Index = " + index + " value = " + value.metadata.name);
                            name_list.usernames.push(value.metadata.name);
                            if (value.groups) {
                                console.log("groups = "+value.groups);
                                var groupl = value.groups.split(",");
                                for (var i = groupl.length - 1; i >= 0; i--) {
                                    name_list.groupnames.push(groupl[i]);
                                };
                            }
                        });
                    }
                    return name_list;
                }*/

                $scope.formatMembers = function format_members(members) {
                    var mlist = "";
                    if (!members)
                        return mlist;
                    for (var i = members.length - 1; i >= 0; i--) {
                        mlist += members[i] + ",";
                    }
                    return mlist;
                };

            }
        ]);
});

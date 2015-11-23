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
        'kubeClient',
    ])

    .config([
        '$routeProvider',
        function($routeProvider) {
            $routeProvider.when('/projects', {
                templateUrl: 'views/projects-page.html',
                controller: 'ProjectsCtrl',
                reloadOnSearch: false,
            });
        }
    ])

    .controller('ProjectsCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        function($scope, loader, select) {

            loader.watch(["users"]);
            loader.watch(["groups"]);
            loader.watch(["policybindings"]);
            loader.load("projects");

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


/* 
                var name_list = {
                    usernames: null,
                    groupnames: null
                };
               $scope.get_all_members = function get_all_members() {
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

}());

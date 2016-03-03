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

    angular.module('registry.projects', [
        'ngRoute',
        'ui.cockpit',
        'kubeClient',
        'kubernetes.listing',
        'ui.cockpit',
    ])

    .config(['$routeProvider',
        function($routeProvider) {
            $routeProvider
                .when('/projects/:namespace?', {
                    controller: 'ProjectsCtrl',
                    templateUrl: function(params) {
                        if (!params['namespace'])
                            return 'views/projects-page.html';
                        else
                            return 'views/project-page.html';
                    }
                });
        }
    ])

    .controller('ProjectsCtrl', [
        '$scope',
        '$routeParams',
        '$location',
        'kubeSelect',
        'kubeLoader',
        'projectData',
        'projectActions',
        'ListingState',
        'roleActions',
        function($scope, $routeParams, $location, select, loader, projectData, projectAction, ListingState, roleAction) {
            loader.watch("users");
            loader.watch("groups");
            loader.watch("policybindings");

            var namespace = $routeParams["namespace"] || "";
            if (namespace) {
                $scope.listing = new ListingState($scope);

                $scope.project = function() {
                    return select().kind("Project").name(namespace).one();
                };

                $scope.roles = function(member) {
                    var oc_roles = rolefilterService.getRoles(member, namespace);
                    var defined_roles = rolefilterService.getDefinedRoles();
                    var roles = [];
                    angular.forEach(oc_roles, function(role) {
                        if (role in defined_roles)
                            roles.push(defined_roles[role]);
                    });
                    return roles.join();
                }

                $scope.isRoleExists = function(member, role) {
                    var oc_roles = rolefilterService.getRoles(member, namespace);
                    if(oc_roles.indexOf(role) !== -1) {
                        return true;
                    }
                    return false;
                }

                $scope.isRoles = function(member) {
                    var oc_roles = rolefilterService.getRoles(member, namespace);
                    if(oc_roles.length == 0) {
                        return false;
                    }
                    return true;
                }

                $scope.changeRole = function(member, role) {
                    var default_policybinding = select().kind("PolicyBinding").namespace(namespace).name(":default").one();
                    if(default_policybinding){
                        var policybindings = select().kind("PolicyBinding").namespace(namespace);
                        angular.forEach(policybindings, function(pb) {
                            console.log(pb);
                        });
                    } else {

                    }


                    projectAction.addRoles(namespace, member, role, action);
                    console.log("changeRole role "+ role);
                }

                $scope.rolefilter = rolefilterService;

            } else {

                $scope.listing = new ListingState($scope);

                $scope.projects = function() {
                    return select().kind("Project");
                };

                $scope.$on("activate", function(ev, id) {
                    if (!$scope.listing.expandable) {
                        ev.preventDefault();
                        $location.path('/projects/' + id);
                    }
                });
            }

            angular.extend($scope, projectData);
            angular.extend($scope, roleAction);
            angular.extend($scope, projectAction);

            $scope.users = function() {
                return select().kind("User");
            };

            $scope.groups = function() {
                return select().kind("Group");
            };
        }
    ])

    .factory('rolefilterService', [
        'projectData',
        'kubeSelect',
        'kubeLoader',
        function(projectData, select, loader) {

            var roles = {"admin":"Admin" , "edit":"Push", "view":"Pull" };

            function getRoles(member, projectName) {
                var roleBinds = projectData.subjectRoleBindings(member, projectName);
                var roleBind, meta, ret = [];
                angular.forEach(roleBinds, function(roleBind) {
                    meta = roleBind.metadata || { };
                    if (meta.name)
                        ret.push(meta.name);
                });
                return ret;
            }

            function getDefinedRoles() {
                return roles;
                //return Object.keys(roles);
            }
           
            return {
                getRoles: getRoles,
                getDefinedRoles: getDefinedRoles,
            };
        }
    ])

    .factory("projectData", [
        'kubeSelect',
        'kubeLoader',
        function(select, loader) {
            loader.watch("users");
            loader.watch("groups");
            function getAllMembers() {
                var users = select().kind("User");
                var groups = select().kind("Groups");
                var members = [];
                angular.forEach(users, function(user) {
                    members.push(user);
                });
                angular.forEach(groups, function(group) {
                    members.push(group);
                });
                return members;
            }
            /*
             * Data loading hacks:
             *
             * We would like to watch rolebindings, but sadly that's not supported
             * by origin. So we have to watch policybindings and then infer the
             * rolebindings from there.
             *
             * In addition we would like to be able to load User and Group objects,
             * even if only for a certain project. However, non-cluster admins
             * fail to do this, so we simulate these objects from the role bindings.
             */
            loader.listen(function(present, removed) {
                var link;
                for (link in removed) {
                    if (removed[link].kind == "PolicyBinding")
                        update_rolebindings(removed[link].roleBindings, true);
                }
                for (link in present) {
                    if (present[link].kind == "PolicyBinding")
                        update_rolebindings(present[link].roleBindings, false);
                    else if (present[link].kind == "RoleBinding")
                        ensure_subjects(present[link].subjects || []);
                }
            });

            function update_rolebindings(bindings, removed) {
                angular.forEach(bindings || [], function(wrapper) {
                    loader.handle(wrapper.roleBinding, removed, "RoleBinding");
                });
            }

            function ensure_subjects(subjects) {
                angular.forEach(subjects, function(subject) {
                    var link = loader.resolve(subject.kind, subject.name, subject.namespace);
                    if (link in loader.objects)
                        return;

                    /* An interim object, until perhaps the real thing can be loaded */
                    var interim = { kind: subject.kind, apiVersion: "v1", metadata: { name: subject.name } };
                    if (subject.namespace)
                        interim.metadata.namespace = subject.namespace;
                    loader.handle(interim);
                });
            }

            /*
             * To use this you would have a user or group, and do:
             *
             * rolebindings = select().kind("RoleBindings").containsSubject(user_name);
             * rolebindings = select().kind("RoleBindings").containsSubject(user_object);
             * rolebindings = select().kind("RoleBindings").containsSubject(group_object);
             */
            select.register({
                name: "containsSubject",
                digests: function(arg) {
                    var meta, i, len, subjects, ret = [];
                    if (typeof arg == "string") {
                        ret.push(arg);
                    } else if (arg.kind == "User" || arg.kind == "Group") {
                        meta = arg.metadata || { };
                        ret.push(meta.name + ":" + arg.kind);
                    } else if (arg.kind == "RoleBinding") {
                        subjects = arg.subjects || [];
                        for (i = 0, len = subjects.length; i < len; i++) {
                            ret.push(subjects[i].name);
                            ret.push(subjects[i].name + ":" + subjects[i].kind);
                        }
                    }
                    return ret;
                }
            });

            function subjectRoleBindings(subject, namespace) {
                return select().kind("RoleBinding").namespace(namespace).containsSubject(subject);
            }

            function subjectIsMember(subject, namespace) {
                return subjectRoleBindings(subject, namespace).one() ? true : false;
            }

            function formatMembers(members, kind) {
                var mlist = "";
                var i;
                if (!members || members.length === 0)
                    return mlist;
                if (members.length <= 3) {
                    for (i = members.length - 1; i >= 0; i--) {
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
            }

            return {
                subjectRoleBindings: subjectRoleBindings,
                subjectIsMember: subjectIsMember,
                formatMembers: formatMembers,
                getAllMembers: getAllMembers,
            };
        }
    ])

    .directive('projectPanel', [
        'kubeLoader',
        'kubeSelect',
        function(loader, select) {
            return {
                restrict: 'A',
                scope: true,
                link: function(scope, element, attrs) {
                    var tab = 'main';
                    scope.tab = function(name, ev) {
                        if (ev) {
                            tab = name;
                            ev.stopPropagation();
                        }
                        return tab === name;
                    };

                    var currProject = scope.id;
                    loader.load("Project", null, null);
                    scope.project = function() {
                        return select().kind("Project").name(currProject).one();
                    };

                },
                templateUrl: "views/project-panel.html"
            };
        }
    ])

    .directive('projectListing',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/project-listing.html'
            };
        }
    )

    .factory('projectActions', [
        '$modal',
        function($modal) {
            function createProject() {
                return $modal.open({
                    controller: 'ProjectModifyCtrl',
                    templateUrl: 'views/project-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { };
                        }
                    },
                }).result;
            }

            function modifyProject(project) {
                return $modal.open({
                    animation: false,
                    controller: 'ProjectModifyCtrl',
                    templateUrl: 'views/project-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { project: project };
                        }
                    },
                }).result;
            }

            function createUser() {
                return $modal.open({
                    controller: 'UserNewCtrl',
                    templateUrl: 'views/add-user-dialog.html',
                });
            }
            function createGroup() {
                return $modal.open({
                    controller: 'GroupNewCtrl',
                    templateUrl: 'views/add-group-dialog.html',
                });
            }

            function addMemberRole(namespace, member, role) {
                return $modal.open({
                    controller: 'RoleBindingNewCtrl',
                    templateUrl: 'views/add-member-role-dialog.html',
                    resolve: {
                        fields: function () {
                            
                            var items = {
                                //role: role,
                                //namespace: namespace,
                                //user_name: member.kind == "User"? member.metadata.name : "",
                                //group_name: member.kind == "Group"? member.metadata.name : "",
                                //member: member.metadata.name,
                                //



                                //kind: member.kind,
                            }
                            return items;
                        },
                        
                    },
                });
            }

            function addRoles(namespace, member, role, action) {
                return $modal.open({
                    controller: 'RoleBindingNewCtrl',
                    templateUrl: function() {
                        if (action == "remove")
                            return 'views/remove-role-dialog.html';
                        else
                            return 'views/add-role-dialog.html';
                    },
                    resolve: {
                        fields: function () {
                            var items = {
                                role: role,
                                namespace: namespace,
                                user_name: member.kind == "User"? member.metadata.name : "",
                                group_name: member.kind == "Group"? member.metadata.name : "",
                                member: member.metadata.name,
                                kind: member.kind,
                            }
                            return items;
                        }
                    },
                });
            }

            return {
                createProject: createProject,
                modifyProject: modifyProject,
                createGroup: createGroup,
                createUser: createUser,
                addRoles: addRoles,
                addMemberRole: addMemberRole,
            };
        }
    ])

    .factory('roleActions', [
        '$modal',
        function($modal) {
            function addMember(namespace) {
                return $modal.open({
                    controller: 'MemberNewCtrl',
                    templateUrl: 'views/add-member-role-dialog.html',
                    resolve: {
                        fields : function(){
                            var fields = {};
                            fields.namespace = namespace;
                            return fields;
                        }
                    },
                });
            }
            return {
                addMember: addMember,
            };
        }
    ])
 
    .factory("roleData", [
        'kubeSelect',
        'kubeLoader',
        "kubeMethods",
        function(select, loader, methods) {
            loader.watch("policybindings");
            var roles = [{ ocRole: "registry-admin", displayRole :"Admin"},
                { ocRole:"registry-editor", displayRole :"Push" },
                { ocRole:"registry-viewer", displayRole :"Pull" }];

            function getPolicyBinding(namespace){
                return select().kind("PolicyBinding").namespace(namespace).name(":default").one();
            }
            function getDefinedRoles() {
                return roles;
            }
            function appendUsernames(member, userNames) {
                if (!userNames)
                    userNames = [];
                if (userNames.indexOf(member) == -1) {
                    userNames.push(member);
                }
                return userNames;
            }
            function appendGroupNames(member, groupNames) {
                if (!groupNames)
                    groupNames = [];
                if (groupNames.indexOf(member) == -1) {
                    groupNames.push(member);
                }
                return groupNames;
            }
            function updateSubjects(member, subjects) {
                var found = false;
                if (!subjects)
                    subjects = [];
                if (subjects.length === 0) {
                    subjects.push(member);
                } else {
                    angular.forEach(subjects , function(s){
                        if (s.kind === member.kind && s.name === member.name) {
                            found = true;
                        }
                    });
                    if (!found)
                        subjects.push(member);
                }
                return subjects;
            }
            function updateRoleData(member, kind, roleBinding) {
                if (kind === "User")
                    roleBinding.userNames = appendUsernames(member, roleBinding.userNames);
                else
                    roleBinding.groupNames = appendGroupNames(member, roleBinding.groupNames);

                roleBinding.subjects = updateSubjects({
                        kind: kind,
                        name: member
                    }, roleBinding.subjects);
                return roleBinding;
            }

            function getRoleBindings(namespace) {
                var rolebindings = null;
                var default_policybinding = select().kind("PolicyBinding").namespace(namespace).name(":default");
                if(default_policybinding.one()){
                    var policybindings = default_policybinding.one();
                    rolebindings = policybindings.roleBindings;
                } 
                return rolebindings;
            }
            function patchPolicBinding(member, role, namespace) {
                var i;
                var roleBinding;
                var roleBindingDefault = {
                    kind: "RoleBinding",
                    apiVersion: "v1",
                    metadata: {
                        name: role,
                        namespace: namespace,
                        creationTimestamp: null,
                    },
                    userNames: [],
                    groupNames: [],
                    subjects: [],
                    roleRef: {
                        name: role
                    }
                };
                var roleBindings = getRoleBindings(namespace);
                var patchData = { "roleBindings": roleBindings };
                angular.forEach(roleBindings, function(rb) {
                    if(rb.name === role) {
                        roleBinding = rb.roleBinding;
                    }
                });
                if (!roleBinding) {
                    //If roleBinding doesn't exists, then create.
                    roleBinding = updateRoleData(member.metadata.name, member.kind, roleBindingDefault);
                    return methods.create(roleBinding, namespace);   
                } else {
                    //If roleBinding exists, then patch.
                    roleBinding = updateRoleData(member.metadata.name, member.kind, roleBinding);
                    for (i = patchData.roleBindings.length - 1; i >= 0; i--) {
                        if(patchData.roleBindings[i].name === role) {
                            patchData.roleBindings[i].roleBinding = roleBinding;
                        }
                    }
                    var patchObj = getPolicyBinding(namespace);
                    return methods.patch(patchObj, patchData);
                }   
            }

            return {
                getDefinedRoles: getDefinedRoles,
                patchPolicBinding: patchPolicBinding,
            };
        }
    ])

    .controller('MemberNewCtrl', [
        '$q',
        '$scope',
        'projectData',
        'roleData',
        'fields',
        function($q, $scope, projectData, roleData, fields) {
            $scope.select = {
                member: 'Select Members',
                members: projectData.getAllMembers(),
                displayRole: 'Select Role',
                roles: roleData.getDefinedRoles(),
                kind: "",
                ocRole: "",
            };

            var namespace = fields.namespace;

            function validate() {
                var defer = $q.defer();
                var memberName = $scope.select.member;
                var role = $scope.select.ocRole;
                var ex;

                if (!memberName || memberName === 'Select Members') {
                    ex = new Error("Please select a valid Member");
                    ex.target = "#add_member";
                    defer.reject(ex);
                }
                if (!role || role === 'Select Role') {
                    ex = new Error("Please select a valid Role");
                    ex.target = "#add_role";
                    defer.reject(ex);
                }

                if (!ex) {
                    defer.resolve();
                }

                return defer.promise;
            }            
            $scope.performCreate = function performCreate() {
                var role = $scope.select.ocRole;
                var memberObj = $scope.select.memberObj;
                return validate().then(function() {
                    return roleData.patchPolicBinding(memberObj, role, namespace);
                });
            };
        }
    ])

    .controller('ProjectModifyCtrl', [
        '$q',
        '$scope',
        "dialogData",
        "kubeMethods",
        function($q, $scope, dialogData, methods) {
            var project = dialogData.project || { };
            var meta = project.metadata || { };
            var annotations = meta.annotations || { };

            var DISPLAY = "openshift.io/display-name";
            var DESCRIPTION = "openshift.io/description";

            var fields = {
                name: meta.name || "",
                display: annotations[DISPLAY] || "",
                description: annotations[DESCRIPTION] || "",
            };

            $scope.fields = fields;

            $scope.performCreate = function performCreate() {
                var defer;

                var request = {
                    kind: "ProjectRequest",
                    apiVersion:"v1",
                    metadata:{ name: fields.name.trim(), },
                    displayName: fields.display.trim(),
                    description: fields.description.trim()
                };

                return methods.check(request, { "metadata.name": "#project-new-name" })
                    .then(function() {
                        return methods.create(request);
                    });
            };

            $scope.performModify = function performModify() {
                var anno = { };
                var data = { metadata: { annotations: anno } };

                var value = fields.display.trim();
                if (value !== annotations[DISPLAY])
                    anno[DISPLAY] = value;
                value = fields.description.trim();
                if (value !== annotations[DESCRIPTION])
                    anno[DESCRIPTION] = value;

                return methods.check(data, { })
                    .then(function() {
                        return methods.patch(project, data);
                    });
            };

            angular.extend($scope, dialogData);
        }
    ])

    .controller('RoleBindingNewCtrl', [
        '$q',
        '$scope',
        "kubeMethods",
        'projectData',
        'kubeSelect',
        'kubeLoader',
        'fields',
        function($q, $scope, methods, util, select, loader, fields) {
            $scope.fields = fields;
            loader.watch("users");
            $scope.users = function() {
                return select().kind("User");
            };

            $scope.performRemove = function performRemove(member) {
                console.log($scope);
                var defer = $q.defer();
                var role = $scope.fields.role.trim();
                var namespace = $scope.fields.namespace.trim();
                var user_name = $scope.fields.user_name.trim();
                var group_name = $scope.fields.group_name.trim();
                var kind = $scope.fields.kind.trim();

                var rolebinding = {
                    kind: "RoleBinding",
                    apiVersion: "v1",
                    metadata: {
                        name: role,
                        namespace: namespace,
                        },
                    userNames: [user_name],
                    groupNames: [group_name],
                    subjects: [{ kind: kind, name:member }],
                    roleRef: { name: role }
                };
                console.log(rolebinding);
                return defer.resolve();
                //return methods.update(project, namespace);
            };

            $scope.performAppend = function performAppend() {
                console.log($scope);
                var defer = $q.defer();
                var role = $scope.fields.role.trim();
                var namespace = $scope.fields.namespace.trim();
                var user_name = $scope.fields.user_name.trim();
                var group_name = $scope.fields.group_name.trim();
                var kind = $scope.fields.kind.trim();

                var rolebinding = {
                    kind: "RoleBinding",
                    apiVersion: "v1",
                    metadata: {
                        name: role,
                        namespace: namespace,
                        },
                    userNames: [user_name],
                    groupNames: [group_name],
                    subjects: [{ kind: kind, name:member }],
                    roleRef: { name: role }
                };
                console.log(rolebinding);
                return defer.resolve();
                //return methods.create(project, namespace);
            };
        }
    ])

    .controller('UserNewCtrl', [
        '$q',
        '$scope',
        "kubeMethods",
        function($q, $scope, methods) {
            var fields = {
                name: "",
                identities: ""
            };

            $scope.fields = fields;

            $scope.performCreate = function performCreate() {
                var defer;
                var identities = [];
                if (fields.identities.trim() !== "")
                    identities = [fields.identities.trim()];

                var user = {
                    "kind": "User",
                    "apiVersion": "v1",
                    "metadata": {
                        "name": fields.name.trim()
                    },
                    "identities": identities
                };

                return methods.check(user, { "metadata.name": "#user_name" })
                    .then(function() {
                        return methods.create(user);
                    });
            };
        }
    ])

    .controller('GroupNewCtrl', [
        '$q',
        '$scope',
        "kubeMethods",
        function($q, $scope, methods) {
            var fields = {
                name: ""
            };

            $scope.fields = fields;

            $scope.performCreate = function performCreate() {
                var defer;

                var group = {
                    "kind": "Group",
                    "apiVersion": "v1",
                    "metadata": {
                        "name": fields.name.trim()
                    }
                };

                return methods.check(group, { "metadata.name": "#group_name" })
                    .then(function() {
                        return methods.create(group);
                    });
            };
        }
    ]);
}());

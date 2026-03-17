/*
  Name: Open edX AuthZ Course Permission Validation Performance Test
  Test type: Load test
  Maintained by: eduNEXT
  Description: Tests the performance of the AuthZ permission validation endpoint
    for COURSE permissions under high load scenarios.

    Usage:
      $ cd authz && k6 run test_courses.js -e PROFILE=profiles/authz_small.json
      $ cd authz && ./run_authz_test.sh authz_small courses
*/

import {
  getProfile,
  getUser,
  buildOptions,
  runSetup,
  runVU,
  runTeardown,
  buildHandleSummary,
} from "./shared.js";

const PROFILE = getProfile();

const COURSE_ACTIONS = [
  "courses.view_course",
  "courses.view_course_updates",
  "courses.view_pages_and_resources",
  "courses.view_files",
  "courses.view_grading_settings",
  "courses.view_course_team",
  "courses.edit_course_content",
  "courses.publish_course_content",
  "courses.manage_course_updates",
  "courses.manage_pages_and_resources",
  "courses.create_files",
  "courses.edit_files",
  "courses.delete_files",
  "courses.edit_grading_settings",
  "courses.manage_course_team",
  "courses.manage_advanced_settings",
  "courses.create_course",
];

const CONFIG = {
  label: "course",
  roles: ["course_admin", "course_staff", "course_editor"],
  actions: COURSE_ACTIONS,
  scopes: PROFILE["authz_course_test_scopes"] || [
    "course-v1:OpenedX+DemoX+DemoCourse",
    "course-v1:MIT+6.001+2024_T1",
  ],
  permissionsPerRequest: PROFILE["authz_permissions_per_request"] || 10,
  lmsRootUrl: PROFILE["lms_root_url"],
  sleepTime: PROFILE["sleep_time"] || 1,
  runSetup: PROFILE["run_setup"] !== undefined ? PROFILE["run_setup"] : true,
  username: PROFILE["authz_username"] || "admin",
  password: PROFILE["authz_password"] || "admin",
  clientId: PROFILE["authz_client_id"] || "login-service-client-id",
};

export const options = buildOptions(PROFILE);

export function setup() {
  return runSetup(CONFIG);
}

export default function (data) {
  runVU(CONFIG, data);
}

export function teardown(data) {
  runTeardown(CONFIG, data);
}

export const handleSummary = buildHandleSummary(CONFIG);

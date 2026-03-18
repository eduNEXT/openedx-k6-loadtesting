/*
  Name: Open edX AuthZ Course Permission Validation Performance Test
  Test type: Load test
  Maintained by: eduNEXT
  Description: Tests the performance of the AuthZ permission validation endpoint
    for COURSE permissions under high load scenarios.

    Supports two scope modes (via SCOPE_MODE env var or profile field):
      - "direct" (default): assigns roles to explicit course scopes and validates against them.
      - "glob": assigns roles using wildcard patterns (e.g., course-v1:OpenedX+*) and
        validates against specific courses under that pattern.

    Usage:
      $ cd authz && k6 run test_courses.js -e PROFILE=profiles/authz_small.json
      $ cd authz && k6 run test_courses.js -e PROFILE=profiles/authz_small.json -e SCOPE_MODE=glob
      $ cd authz && ./run_authz_test.sh authz_small courses
*/

import {
  getProfile,
  buildOptions,
  runSetup,
  runVU,
  runTeardown,
  buildHandleSummary,
} from "./shared.js";

const PROFILE = getProfile();
const SCOPE_MODE = PROFILE["scope_mode"] || __ENV.SCOPE_MODE || "direct";

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

const DIRECT_SCOPES = PROFILE["course_direct_scopes"] || [
  "course-v1:WGU+CS+2026",
  "course-v1:edunext+PY+2026",
  "course-v1:OpenedX+DMS+2026",
];

const GLOB_ASSIGNMENT_SCOPES = PROFILE["course_glob_patterns"] || [
  "course-v1:WGU+*",
  "course-v1:edunext+*",
  "course-v1:OpenedX+*",
];

const CONFIG = {
  label: SCOPE_MODE === "glob" ? "course-glob" : "course-direct",
  roles: ["course_admin", "course_staff", "course_editor"],
  actions: COURSE_ACTIONS,
  scopes: DIRECT_SCOPES,
  assignmentScopes: SCOPE_MODE === "glob" ? GLOB_ASSIGNMENT_SCOPES : DIRECT_SCOPES,
  permissionsPerRequest: PROFILE["permissions_per_request"] || 10,
  lmsRootUrl: PROFILE["lms_root_url"],
  sleepTime: PROFILE["sleep_time"] || 1,
  runSetup: PROFILE["run_setup"] !== undefined ? PROFILE["run_setup"] : true,
  username: __ENV.AUTHZ_USERNAME || "admin",
  password: __ENV.AUTHZ_PASSWORD || "admin",
  clientId: PROFILE["authz_client_id"] || __ENV.AUTHZ_CLIENT_ID || "login-service-client-id",
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

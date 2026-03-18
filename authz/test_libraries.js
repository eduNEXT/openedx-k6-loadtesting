/*
  Name: Open edX AuthZ Library Permission Validation Performance Test
  Test type: Load test
  Maintained by: eduNEXT
  Description: Tests the performance of the AuthZ permission validation endpoint
    for LIBRARY permissions under high load scenarios.

    Supports two scope modes (via SCOPE_MODE env var or profile field):
      - "direct" (default): assigns roles to explicit library scopes and validates against them.
      - "glob": assigns roles using wildcard patterns (e.g., lib:OpenedX:*) and
        validates against specific libraries under that pattern.

    Usage:
      $ cd authz && k6 run test_libraries.js -e PROFILE=profiles/authz_small.json
      $ cd authz && k6 run test_libraries.js -e PROFILE=profiles/authz_small.json -e SCOPE_MODE=glob
      $ cd authz && ./run_authz_test.sh authz_small libraries
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

const LIBRARY_ACTIONS = [
  "content_libraries.view_library",
  "content_libraries.view_library_team",
  "content_libraries.manage_library_team",
  "content_libraries.edit_library",
  "content_libraries.delete_library",
  "content_libraries.publish_library",
  "content_libraries.manage_library_tags",
  "content_libraries.delete_library_content",
  "content_libraries.publish_library_content",
  "content_libraries.edit_library_content",
  "content_libraries.create_library_content",
  "content_libraries.create_library_collection",
  "content_libraries.edit_library_collection",
  "content_libraries.delete_library_collection",
  "content_libraries.reuse_library_content",
  "content_libraries.create_library",
  "content_libraries.view_library_collection",
];

const DIRECT_SCOPES = PROFILE["library_direct_scopes"] || [
  "lib:WGU:CSPROB",
  "lib:edunext:Python",
  "lib:OpenedX:DMS",
];

const GLOB_ASSIGNMENT_SCOPES = PROFILE["library_glob_patterns"] || [
  "lib:WGU:*",
  "lib:edunext:*",
  "lib:OpenedX:*",
];

const CONFIG = {
  label: SCOPE_MODE === "glob" ? "library-glob" : "library-direct",
  roles: ["library_admin", "library_author", "library_user"],
  actions: LIBRARY_ACTIONS,
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

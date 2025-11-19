/*
  Name: Open edX AuthZ Library Permission Validation Performance Test
  Test type: Load test
  Maintained by: eduNEXT
  Description: This load test focuses on measuring the performance of the Open edX Authorization (AuthZ)
    permission validation endpoint for LIBRARY permissions under high load scenarios.

    The test simulates realistic scenarios where users validate multiple library permissions simultaneously,
    which is common when accessing library content, managing library teams, and performing library operations.

    The test requires the definition of an environment variable called "PROFILE" in order to define a
    set of test variables like the LMS url. The list of available profiles is contained in the folder
    ./profiles as JSON files. To run the test against a profile, just run the test indicating the
    profile name (with no extension) as follows:

      $ k6 run test_authz.js -e PROFILE=<profile_name>

    The test progressively increases load from 10 to 100 concurrent users to identify performance
    degradation points and measure scalability. Each VU simulates a user validating multiple library permissions.

    REPORTING:
    Generate detailed reports using k6's output options:
      - JSON: k6 run test_authz.js --out json=results.json
      - InfluxDB: k6 run test_authz.js --out influxdb=http://localhost:8086/k6
      - Cloud: k6 run test_authz.js --out cloud
      - HTML Report: Use k6-reporter or xk6-dashboard extensions

    The flow executed by every VU in the test is described below:
    - Setup: Create test users and assign them to different library roles
    - Each VU represents a user with specific role assignments
    - Obtain OAuth2 access token using password grant type (once per VU)
    - Continuously validate multiple library permissions (main load test focus)
    - Track response times and error rates under increasing load from 10 to 100 users
    - Test validates how role assignments affect permission validation performance
*/

/*
  1. INIT CODE
*/

import http from "k6/http";
import { sleep, check } from "k6";
import exec from "k6/execution";
import { Trend, Counter } from "k6/metrics";
import { get_profile, getUser } from "./utils.js";
import { URL } from 'https://jslib.k6.io/url/1.0.0/index.js';

const PROFILE = get_profile();

const LMS_ROOT_URL = PROFILE["lms_root_url"];
const SLEEP_TIME = PROFILE["sleep_time"] || 1;

// AuthZ specific configuration
const OAUTH2_TOKEN_PATH = "/oauth2/access_token/";
const AUTHZ_PERMISSIONS_VALIDATE_PATH = "/api/authz/v1/permissions/validate/me";
const AUTHZ_ROLES_USERS_PATH = "/api/authz/v1/roles/users/";

// Test data - can be configured via profile
// Only testing library scopes to measure library permission performance
const TEST_SCOPES = PROFILE["authz_test_scopes"] || [
  "lib:Openedx:CSPROB",
  "lib:OpenedX:CE",
  "lib:MIT:LIB1",
  "lib:OpenedX:DMS",
  "lib:OpenedX:LANGP",
  "lib:OpenedX:OPTI"
];
const TEST_USERNAME = PROFILE["authz_username"] || "admin";
const TEST_PASSWORD = PROFILE["authz_password"] || "admin";
const CLIENT_ID = PROFILE["authz_client_id"] || "login-service-client-id";
const PERMISSIONS_PER_REQUEST = PROFILE["authz_permissions_per_request"] || 10;
const RUN_SETUP = PROFILE["run_setup"] !== undefined ? PROFILE["run_setup"] : true;

// Library roles to assign to users
const LIBRARY_ROLES = [
  "library_admin",
  "library_author",
  "library_user",
];

// Custom metrics for detailed analysis
const permissionValidationDuration = new Trend("permission_validation_duration");
const permissionValidationErrors = new Counter("permission_validation_errors");

export const options = {
  // Progressive load stages: 10 → 25 → 50 → 75 → 100 concurrent users
  stages: PROFILE.stages || [
    { target: 10, duration: "2m" },   // Ramp up to 10 users
    { target: 10, duration: "3m" },   // Stay at 10 users (baseline)
    { target: 25, duration: "2m" },   // Ramp up to 25 users
    { target: 25, duration: "3m" },   // Stay at 25 users
    { target: 50, duration: "2m" },   // Ramp up to 50 users
    { target: 50, duration: "4m" },   // Stay at 50 users (stress test)
    { target: 75, duration: "2m" },   // Ramp up to 75 users
    { target: 75, duration: "3m" },   // Stay at 75 users
    { target: 100, duration: "2m" },  // Ramp up to 100 users
    { target: 100, duration: "4m" },  // Stay at 100 users (peak load)
    { target: 0, duration: "2m" },    // Ramp down gracefully
  ],
  thresholds: {
    "http_req_failed": ["rate<0.05"],  // Less than 5% of requests should fail
    "http_req_duration": ["p(95)<3000", "p(99)<5000"],  // 95% under 3s, 99% under 5s
    "permission_validation_duration": ["p(95)<2500", "p(99)<5000"],
    "permission_validation_errors": ["count<50"],  // Less than 50 total errors across entire test
  },
  // Keep cookies across iterations for the same VU
  noCookiesReset: true,
  // Add summary trend stats for better reporting
  summaryTrendStats: ["min", "avg", "med", "max", "p(90)", "p(95)", "p(99)", "p(99.9)"],
  // Time limit for setup phase (user creation and role assignment)
  setupTimeout: "20m",
};

/*
  2. HELPER FUNCTIONS
*/

/**
 * Create a test user using auto_auth endpoint
 */
function createTestUser(userIndex) {
  const user = getUser(userIndex);
  const lmsUrl = new URL(`${LMS_ROOT_URL}/auto_auth`);
  lmsUrl.searchParams.append('username', user.username);
  lmsUrl.searchParams.append('email', user.email);
  lmsUrl.searchParams.append('password', user.password);
  lmsUrl.searchParams.append('is_active', user.is_active.toString());
  lmsUrl.searchParams.append('redirect', "false");

  const res = http.get(lmsUrl.toString());

  if (res.status === 200) {
    console.info(`✓ Created user ${user.username}: [${res.status}]`);
    return user;
  } else {
    console.error(`✗ Failed to create user ${user.username}: [${res.status}] ${res.body}`);
    return null;
  }
}

/**
 * Assign users to library roles for a specific scope
 * Returns the admin token for making the API call
 */
function assignUsersToRoles(adminToken, users, scope) {
  const url = `${LMS_ROOT_URL}${AUTHZ_ROLES_USERS_PATH}`;

  let totalAssigned = 0;
  let totalErrors = 0;

  // Assign users to different roles in round-robin fashion
  for (let i = 0; i < LIBRARY_ROLES.length; i++) {
    const role = LIBRARY_ROLES[i];

    // Get subset of users for this role
    const usersForRole = users
      .filter((_, idx) => idx % LIBRARY_ROLES.length === i)
      .map(u => u.username);

    if (usersForRole.length === 0) continue;

    const payload = JSON.stringify({
      users: usersForRole,
      role: role,
      scope: scope,
    });

    const params = {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `JWT ${adminToken}`,
      },
    };

    const res = http.put(url, payload, params);

    if (res.status === 207 || res.status === 200) {
      const body = JSON.parse(res.body);
      const completed = body.completed ? body.completed.length : 0;
      const errors = body.errors ? body.errors.length : 0;
      totalAssigned += completed;
      totalErrors += errors;
      console.info(`  → Assigned ${completed} users to role '${role}' for scope '${scope}'`);
      if (errors > 0) {
        console.warn(`    Errors: ${errors}`);
      }
    } else {
      console.error(`  ✗ Failed to assign users to role '${role}': [${res.status}] ${res.body}`);
    }

    sleep(0.5); // Small delay between role assignments
  }

  return { assigned: totalAssigned, errors: totalErrors };
}

/**
 * Get admin OAuth2 token for setup operations
 */
function getAdminToken() {
  const url = `${LMS_ROOT_URL}${OAUTH2_TOKEN_PATH}`;

  const payload = {
    grant_type: "password",
    token_type: "JWT",
    client_id: CLIENT_ID,
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
  };

  const params = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  const res = http.post(url, payload, params);

  if (res.status === 200) {
    const body = JSON.parse(res.body);
    return body.access_token;
  }
  return null;
}

/**
 * Obtain OAuth2 access token using password grant type
 */
function getAccessToken(username, password) {
  const url = `${LMS_ROOT_URL}${OAUTH2_TOKEN_PATH}`;

  const payload = {
    grant_type: "password",
    token_type: "JWT",
    client_id: CLIENT_ID,
    username: username || TEST_USERNAME,
    password: password || TEST_PASSWORD,
  };

  const params = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  const res = http.post(url, payload, params);

  check(res, {
    "Authorization successful": (r) => r.status === 200,
    "Access token received": (r) => {
      if (r.status === 200) {
        const body = JSON.parse(r.body);
        return body.access_token !== undefined;
      }
      return false;
    },
  });

  if (res.status === 200) {
    const body = JSON.parse(res.body);
    console.debug(`[${res.status}] ${url} - Token obtained`);
    return body.access_token;
  } else {
    console.error(`[${res.status}] ${url} - Failed to obtain token: ${res.body}`);
    return null;
  }
}

/**
 * Generate a list of library permission checks for validation
 * This simulates a realistic scenario with multiple library permission validations
 */
function generatePermissionChecks(count) {
  // All library-specific permission actions with content_libraries prefix
  const actions = [
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

  const permissions = [];
  for (let i = 0; i < count; i++) {
    permissions.push({
      action: actions[i % actions.length],
      scope: TEST_SCOPES[i % TEST_SCOPES.length],
    });
  }
  return permissions;
}

/**
 * Validate permissions for the authenticated user
 * This is the main endpoint being performance tested
 */
function validatePermissions(accessToken) {
  const url = `${LMS_ROOT_URL}${AUTHZ_PERMISSIONS_VALIDATE_PATH}`;

  // Generate multiple permission checks to simulate realistic load
  const permissions = generatePermissionChecks(PERMISSIONS_PER_REQUEST);
  const payload = JSON.stringify(permissions);

  const params = {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `JWT ${accessToken}`,
    },
    tags: { name: "ValidatePermissions" },  // Tag for easier filtering in results
  };

  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;

  // Record custom metrics
  permissionValidationDuration.add(duration);

  const success = check(res, {
    "Validate permissions successful": (r) => r.status === 200,
    "Permissions response is array": (r) => {
      if (r.status === 200) {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body) && body.length === PERMISSIONS_PER_REQUEST;
        } catch (e) {
          return false;
        }
      }
      return false;
    },
    "All permissions have allowed field": (r) => {
      if (r.status === 200) {
        try {
          const body = JSON.parse(r.body);
          return body.every(p => p.hasOwnProperty("allowed"));
        } catch (e) {
          return false;
        }
      }
      return false;
    },
  });

  if (!success) {
    permissionValidationErrors.add(1);
    console.error(`[${res.status}] ${url} - Failed validation: ${res.body}`);
  } else {
    console.debug(`[${res.status}] ${url} - Validated ${PERMISSIONS_PER_REQUEST} permissions in ${duration}ms`);
  }

  return res;
}

/*
  2.5. SETUP PHASE
*/

export function setup() {
  if (!RUN_SETUP) {
    console.info("Skipping setup phase (run_setup=false)");
    return { users: [] };
  }

  console.log("\n" + "=".repeat(80));
  console.log("SETUP PHASE: Creating users and assigning library roles");
  console.log("=".repeat(80));

  const numUsers = exec.instance.vusInitialized;
  console.info(`Creating ${numUsers} test users...`);

  const users = [];
  for (let i = 0; i < numUsers; i++) {
    const user = createTestUser(i);
    if (user) {
      users.push(user);
    }
    // Small delay to avoid overwhelming the server
    if (i % 10 === 9) {
      sleep(1);
    }
  }

  console.info(`\n✓ Successfully created ${users.length}/${numUsers} users\n`);

  // Get admin token for role assignments
  console.info("Obtaining admin token for role assignments...");
  const adminToken = getAdminToken();

  if (!adminToken) {
    console.error("✗ Failed to obtain admin token. Skipping role assignments.");
    return { users: users };
  }

  console.info("✓ Admin token obtained\n");

  // Assign users to roles for each test scope
  console.info(`Assigning users to library roles across ${TEST_SCOPES.length} scopes...\n`);

  let totalAssignments = 0;
  let totalErrors = 0;

  for (const scope of TEST_SCOPES) {
    console.info(`Scope: ${scope}`);
    const result = assignUsersToRoles(adminToken, users, scope);
    totalAssignments += result.assigned;
    totalErrors += result.errors;
    sleep(1); // Delay between scopes
  }

  console.log("\n" + "=".repeat(80));
  console.log("SETUP COMPLETE");
  console.log("=".repeat(80));
  console.info(`Total users created: ${users.length}`);
  console.info(`Total role assignments: ${totalAssignments}`);
  console.info(`Total assignment errors: ${totalErrors}`);
  console.info(`Roles used: ${LIBRARY_ROLES.join(", ")}`);
  console.info(`Scopes configured: ${TEST_SCOPES.length}`);
  console.log("=".repeat(80) + "\n");

  return { users: users };
}

/*
  3. VU CODE
*/

export default function (data) {
  // Obtain OAuth2 access token only on first iteration
  // Each VU uses a different user based on its index
  if (exec.vu.iterationInScenario === 0) {
    const userIndex = exec.vu.idInTest - 1;
    const user = getUser(userIndex);

    const accessToken = getAccessToken(user.username, user.password);

    if (!accessToken) {
      console.error(`VU ${exec.vu.idInTest} (${user.username}): Failed to obtain access token. Aborting.`);
      exec.vu.tags.token = "failed";
      exec.vu.tags.username = user.username;
      return;
    }

    // Store token and user info for reuse
    exec.vu.tags.token = accessToken;
    exec.vu.tags.username = user.username;
    const roleIndex = userIndex % LIBRARY_ROLES.length;
    exec.vu.tags.role = LIBRARY_ROLES[roleIndex];
    console.info(`VU ${exec.vu.idInTest}: Authenticated as '${user.username}' with role '${LIBRARY_ROLES[roleIndex]}'`);
    sleep(1);
  }

  const accessToken = exec.vu.tags.token;

  if (!accessToken || accessToken === "failed") {
    console.error(`VU ${exec.vu.idInTest}: No valid token available. Skipping iteration.`);
    sleep(SLEEP_TIME);
    return;
  }

  // Main performance test: Validate permissions
  // This is the primary focus of the load test
  validatePermissions(accessToken);

  // Small sleep to simulate think time between requests
  sleep(SLEEP_TIME);
}

/*
  4. TEARDOWN CODE
*/

export function teardown(data) {
  console.log("\n" + "=".repeat(80));
  console.log("LIBRARY PERMISSION VALIDATION PERFORMANCE TEST - SUMMARY");
  console.log("=".repeat(80));
  console.log(`Test completed for library permission validation`);
  console.log(`Load pattern: 10 → 25 → 50 → 75 → 100 concurrent users`);
  console.log(`Permissions validated per request: ${PERMISSIONS_PER_REQUEST}`);
  console.log(`Library scopes tested: ${TEST_SCOPES.length}`);

  if (data && data.users) {
    console.log(`\nUser & Role Configuration:`);
    console.log(`  - Total users created: ${data.users.length}`);
    console.log(`  - Roles assigned: ${LIBRARY_ROLES.join(", ")}`);
    console.log(`  - Distribution: ${Math.ceil(data.users.length / LIBRARY_ROLES.length)} users per role (approx.)`);
  }

  console.log("\nCheck the detailed metrics above for:");
  console.log("  - permission_validation_duration (custom metric)");
  console.log("  - http_req_duration (overall response times)");
  console.log("  - http_req_failed (error rates)");
  console.log("\nFor visual reports, use:");
  console.log("  k6 run test_authz.js --out json=results.json");
  console.log("  Then use https://github.com/benc-uk/k6-reporter or similar tools");
  console.log("=".repeat(80) + "\n");
}

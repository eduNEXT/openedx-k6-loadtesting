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
    profile path as follows:

      $ cd authz && k6 run test_authz.js -e PROFILE=profiles/authz_small.json

    Or use the helper script (recommended):

      $ cd authz && ./run_authz_test.sh authz_small

    The test progressively increases load from 10 to 100 concurrent users to identify performance
    degradation points and measure scalability. Each VU simulates a user validating multiple library permissions.

    REPORTING:
    Reports are automatically saved to the reports/ directory with UTC+1 timestamps.
    The helper script (run_authz_test.sh) handles all report generation:
      - JSON metrics: reports/authz-{profile}-{timestamp}-cet.json
      - Summary: reports/authz-{profile}-{timestamp}-summary.json
      - Console logs: reports/authz-{profile}-{timestamp}.log

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
import { get_profile, getUser } from "../utils.js";
import { URL } from 'https://jslib.k6.io/url/1.0.0/index.js';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

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
  "lib:OpenedX:CSPROB",
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
  } else if (res.status === 401) {
    // Retry once with a delay for 401 errors (rate limiting/auth issues)
    console.warn(`⚠ Got 401 for user ${user.username}, retrying after delay...`);
    sleep(2);
    const retryRes = http.get(lmsUrl.toString());
    if (retryRes.status === 200) {
      console.info(`✓ Created user ${user.username}: [${retryRes.status}] (retry succeeded)`);
      return user;
    } else {
      console.error(`✗ Failed to create user ${user.username}: [${retryRes.status}] ${retryRes.body}`);
      return null;
    }
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
      // Debug log: show payload and headers
      console.debug('  Debug payload:', payload);
      console.debug('  Debug headers:', params.headers);
      console.debug('  Debug scope:', scope);
      console.debug('  Debug users:', usersForRole);
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

  // Log response for debugging
  console.debug(`Token request response for ${username}: status=${res.status}, body_length=${res.body ? res.body.length : 0}`);

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
    console.debug(`[${res.status}] ${url} - Token obtained for user: ${username}`);
    console.debug(`  Token preview: ${body.access_token ? body.access_token.substring(0, 50) + '...' : 'N/A'}`);
    console.debug(`  Token type: ${body.token_type || 'N/A'}`);
    console.debug(`  Expires in: ${body.expires_in || 'N/A'} seconds`);
    return body.access_token;
  } else {
    console.error(`[${res.status}] ${url} - Failed to obtain token for user: ${username}`);
    console.error(`  Response body: ${res.body}`);
    console.error(`  Client ID: ${CLIENT_ID}`);
    console.error(`  Username: ${username}`);
    console.error(`  Response headers: ${JSON.stringify(res.headers)}`);
    if (res.error) {
      console.error(`  Error: ${res.error}`);
    }
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
 * Includes exponential backoff retry logic for failed requests
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

  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  let res;
  let success = false;
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
    res = http.post(url, payload, params);
    const duration = Date.now() - startTime;

    // Record custom metrics
    permissionValidationDuration.add(duration);

    success = check(res, {
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

    if (success) {
      if (retryCount > 0) {
        console.info(`[${res.status}] ${url} - Validated after ${retryCount} retries`);
      } else {
        console.debug(`[${res.status}] ${url} - Validated ${PERMISSIONS_PER_REQUEST} permissions in ${duration}ms`);
      }
      break;
    }

    // If this wasn't the last attempt, apply exponential backoff
    if (attempt < maxRetries) {
      retryCount++;
      const delay = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s
      console.warn(`[${res.status}] ${url} - Retry ${retryCount}/${maxRetries} after ${delay}ms delay`);
      sleep(delay / 1000); // Convert to seconds for k6
    } else {
      // Final failure after all retries
      permissionValidationErrors.add(1);
      console.error(`[${res.status}] ${url} - Failed validation after ${maxRetries} retries: ${res.body}`);
      console.error(`  Request payload: ${payload.substring(0, 500)}...`);
      console.error(`  Response status: ${res.status}`);
      console.error(`  Response headers: ${JSON.stringify(res.headers)}`);
      if (res.error) {
        console.error(`  Error: ${res.error}`);
      }
    }
  }

  return res;
}

/*
  2.5. SETUP PHASE
*/

export function setup() {
  // Record test start time for Grafana URL generation
  const testStartTime = new Date();

  if (!RUN_SETUP) {
    console.info("Skipping setup phase (run_setup=false)");
    return { users: [], testStartTime: testStartTime.toISOString() };
  }

  console.log("\n" + "=".repeat(80));
  console.log("SETUP PHASE: Creating users and assigning library roles");
  console.log("=".repeat(80));
  console.log(`Test start time: ${testStartTime.toISOString()}`);

  const numUsers = exec.instance.vusInitialized;
  console.info(`Creating ${numUsers} test users...`);

  const users = [];
  for (let i = 0; i < numUsers; i++) {
    const user = createTestUser(i);
    if (user) {
      users.push(user);
    }
    // Increase delay to avoid rate limiting and authentication conflicts
    // More aggressive throttling to prevent 401 errors
    sleep(1.5);
  }

  console.info(`\n✓ Successfully created ${users.length}/${numUsers} users\n`);

  // Check if user creation failed critically
  if (users.length === 0) {
    console.error("✗ SETUP FAILED: No users were created. Aborting test.");
    throw new Error("Setup failed: Unable to create any test users");
  }

  if (users.length < numUsers * 0.5) {
    console.error(`✗ SETUP FAILED: Only ${users.length}/${numUsers} users created (less than 50%). Aborting test.`);
    throw new Error(`Setup failed: Only ${users.length}/${numUsers} users created`);
  }

  // Get admin token for role assignments
  console.info("Obtaining admin token for role assignments...");
  const adminToken = getAdminToken();

  if (!adminToken) {
    console.error("✗ SETUP FAILED: Failed to obtain admin token. Aborting test.");
    throw new Error("Setup failed: Unable to obtain admin authentication token");
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

  // Verify role assignments succeeded
  if (totalAssignments === 0) {
    console.error("✗ SETUP FAILED: No role assignments were successful. Aborting test.");
    throw new Error("Setup failed: Unable to assign any roles to users");
  }

  console.log("\n" + "=".repeat(80));
  console.log("SETUP COMPLETE");
  console.log("=".repeat(80));
  console.info(`Total users created: ${users.length}`);
  console.info(`Total role assignments: ${totalAssignments}`);
  console.info(`Total assignment errors: ${totalErrors}`);
  console.log(`Roles used: ${LIBRARY_ROLES.join(", ")}`);
  console.log(`Scopes configured: ${TEST_SCOPES.length}`);
  console.log("=".repeat(80) + "\n");

  return { users: users, testStartTime: testStartTime.toISOString() };
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

    console.info(`VU ${exec.vu.idInTest}: Attempting to get token for user: ${user.username}`);
    const accessToken = getAccessToken(user.username, user.password);

    if (!accessToken) {
      console.error(`VU ${exec.vu.idInTest} (${user.username}): Failed to obtain access token. Aborting.`);
      console.error(`  User index: ${userIndex}`);
      console.error(`  User email: ${user.email}`);
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
    console.error(`  Token value: ${accessToken}`);
    console.error(`  Username: ${exec.vu.tags.username}`);
    console.error(`  Iteration: ${exec.vu.iterationInScenario}`);
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
  const testEndTime = new Date();

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

  // Generate Grafana URL with test time range
  if (data && data.testStartTime) {
    const startTime = new Date(data.testStartTime);
    // Add 5 minute buffer before and after for context
    const grafanaStart = new Date(startTime.getTime() - 5 * 60 * 1000);
    const grafanaEnd = new Date(testEndTime.getTime() + 5 * 60 * 1000);

    const grafanaUrl = `https://vitals.singapore.edunext.cloud/grafana/d/openedxperformance/open-edx-performance?from=${grafanaStart.toISOString()}&to=${grafanaEnd.toISOString()}&var-resolution=3m&refresh=5m`;

    console.log(`\nTest Time Range:`);
    console.log(`  - Start: ${startTime.toISOString()}`);
    console.log(`  - End:   ${testEndTime.toISOString()}`);
    console.log(`  - Duration: ${Math.round((testEndTime - startTime) / 1000 / 60)} minutes`);
    console.log(`\n📊 Grafana Dashboard (with 5min buffer):`);
    console.log(`  ${grafanaUrl}`);
  }

  console.log("\nKey Metrics:");
  console.log("  - permission_validation_duration (custom metric)");
  console.log("  - http_req_duration (overall response times)");
  console.log("  - http_req_failed (error rates)");
  console.log("\nTo save reports with timestamp:");
  console.log("  ./run_authz_test.sh authz_small");
  console.log("=".repeat(80) + "\n");
}

/**
 * Custom summary handler to include Grafana URL in exported summary JSON
 * This function is called by k6 and allows customizing both console output and file exports
 */
export function handleSummary(data) {
  const testEndTime = new Date();

  // Generate Grafana URL if we have test start time
  // k6 stores setup() return value in data.setup_data
  let grafanaUrl = null;
  const setupData = data.setup_data || {};
  if (setupData.testStartTime) {
    const startTime = new Date(setupData.testStartTime);
    const grafanaStart = new Date(startTime.getTime() - 5 * 60 * 1000);
    const grafanaEnd = new Date(testEndTime.getTime() + 5 * 60 * 1000);

    grafanaUrl = `https://vitals.singapore.edunext.cloud/grafana/d/openedxperformance/open-edx-performance?from=${grafanaStart.toISOString()}&to=${grafanaEnd.toISOString()}&var-resolution=3m&refresh=5m`;
  }

  // Add custom metadata to the summary data
  const customSummary = {
    ...data,
    grafanaUrl: grafanaUrl,
    testInfo: {
      testStartTime: setupData.testStartTime,
      testEndTime: testEndTime.toISOString(),
      permissionsPerRequest: PERMISSIONS_PER_REQUEST,
      libraryScopesTested: TEST_SCOPES.length,
      totalUsers: setupData.users?.length || 0,
      roles: LIBRARY_ROLES
    },
    profileConfig: {
      lms_root_url: LMS_ROOT_URL,
      sleep_time: SLEEP_TIME,
      permissions_per_request: PERMISSIONS_PER_REQUEST,
      run_setup: RUN_SETUP,
      test_scopes: TEST_SCOPES,
      client_id: CLIENT_ID,
      stages: PROFILE.stages || options.stages
    }
  };

  // Build return object - k6 will write to these files
  // The 'stdout' key is special and prints to console instead of a file
  const output = {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
  };

  // If SUMMARY_EXPORT env var is set, write custom summary to that path
  const summaryPath = __ENV.SUMMARY_EXPORT;
  if (summaryPath) {
    output[summaryPath] = JSON.stringify(customSummary, null, 2);
  }

  return output;
}

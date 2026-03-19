/*
  Shared infrastructure for Open edX AuthZ performance tests.

  This module provides all reusable logic for both library and course
  permission validation tests. Each test file (test_libraries.js, test_courses.js)
  passes a domain-specific config object and delegates to these functions.
*/

import http from "k6/http";
import { sleep, check } from "k6";
import exec from "k6/execution";
import { Trend, Counter } from "k6/metrics";
import { URL } from "https://jslib.k6.io/url/1.0.0/index.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// --- Profile loading (moved from utils.js) ---

function loadProfile(profilePath) {
  if (profilePath === undefined) {
    return {};
  }
  let profile = {};
  try {
    profile = JSON.parse(open(profilePath));
  } catch (error) {
    console.error("Invalid profile file.");
    throw error;
  }
  return profile;
}

export function getProfile() {
  const defaultProfile = loadProfile("default.json");
  const profile = loadProfile(__ENV.PROFILE);
  return Object.assign(defaultProfile, profile);
}

// --- User generation (moved from utils.js) ---

export function getUser(i) {
  return {
    username: `performance__user_${i + 1}_browser`,
    email: `performance__user_${i + 1}_browser@test.com`,
    password: `password${i + 1}`,
    is_active: true,
    redirect: true,
  };
}

// --- Custom metrics ---

const permissionValidationDuration = new Trend("permission_validation_duration");
const permissionValidationErrors = new Counter("permission_validation_errors");

// --- Constants ---

const OAUTH2_TOKEN_PATH = "/oauth2/access_token/";
const AUTHZ_PERMISSIONS_VALIDATE_PATH = "/api/authz/v1/permissions/validate/me";
const AUTHZ_ROLES_USERS_PATH = "/api/authz/v1/roles/users/";

// --- Helper functions ---

export function createTestUser(userIndex, lmsRootUrl) {
  const user = getUser(userIndex);
  const lmsUrl = new URL(`${lmsRootUrl}/auto_auth`);
  lmsUrl.searchParams.append("username", user.username);
  lmsUrl.searchParams.append("email", user.email);
  lmsUrl.searchParams.append("password", user.password);
  lmsUrl.searchParams.append("is_active", user.is_active.toString());
  lmsUrl.searchParams.append("redirect", "false");

  const res = http.get(lmsUrl.toString());

  if (res.status === 200) {
    console.info(`✓ Created user ${user.username}: [${res.status}]`);
    return user;
  } else if (res.status === 401) {
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

export function getAdminToken(lmsRootUrl, clientId, username, password) {
  const url = `${lmsRootUrl}${OAUTH2_TOKEN_PATH}`;

  const payload = {
    grant_type: "password",
    token_type: "JWT",
    client_id: clientId,
    username: username,
    password: password,
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

export function getAccessToken(lmsRootUrl, clientId, username, password) {
  const url = `${lmsRootUrl}${OAUTH2_TOKEN_PATH}`;

  const payload = {
    grant_type: "password",
    token_type: "JWT",
    client_id: clientId,
    username: username,
    password: password,
  };

  const params = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  const res = http.post(url, payload, params);

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
    console.debug(`  Token preview: ${body.access_token ? `${body.access_token.substring(0, 50)}...` : "N/A"}`);
    console.debug(`  Token type: ${body.token_type || "N/A"}`);
    console.debug(`  Expires in: ${body.expires_in || "N/A"} seconds`);
    return body.access_token;
  } else {
    console.error(`[${res.status}] ${url} - Failed to obtain token for user: ${username}`);
    console.error(`  Response body: ${res.body}`);
    console.error(`  Client ID: ${clientId}`);
    console.error(`  Username: ${username}`);
    console.error(`  Response headers: ${JSON.stringify(res.headers)}`);
    if (res.error) {
      console.error(`  Error: ${res.error}`);
    }
    return null;
  }
}

export function assignUsersToRoles(lmsRootUrl, adminToken, users, scope, roles) {
  const url = `${lmsRootUrl}${AUTHZ_ROLES_USERS_PATH}`;

  let totalAssigned = 0;
  let totalErrors = 0;

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];

    const usersForRole = users
      .filter((_, idx) => idx % roles.length === i)
      .map((u) => u.username);

    if (usersForRole.length === 0) continue;

    const payload = JSON.stringify({
      users: usersForRole,
      role: role,
      scope: scope,
    });

    const params = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `JWT ${adminToken}`,
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
      console.debug("  Debug payload:", payload);
      console.debug("  Debug headers:", params.headers);
      console.debug("  Debug scope:", scope);
      console.debug("  Debug users:", usersForRole);
    }

    sleep(0.5);
  }

  return { assigned: totalAssigned, errors: totalErrors };
}

export function unassignUsersFromRoles(lmsRootUrl, adminToken, users, scope, roles) {
  let totalRemoved = 0;
  let totalErrors = 0;

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];

    const usersForRole = users
      .filter((_, idx) => idx % roles.length === i)
      .map((u) => u.username);

    if (usersForRole.length === 0) continue;

    const url = `${lmsRootUrl}${AUTHZ_ROLES_USERS_PATH}?role=${encodeURIComponent(role)}&scope=${encodeURIComponent(scope)}&users=${encodeURIComponent(usersForRole.join(","))}`;

    const params = {
      headers: {
        Authorization: `JWT ${adminToken}`,
      },
    };

    const res = http.del(url, null, params);

    if (res.status === 207 || res.status === 200) {
      const body = JSON.parse(res.body);
      const completed = body.completed ? body.completed.length : 0;
      const errors = body.errors ? body.errors.length : 0;
      totalRemoved += completed;
      totalErrors += errors;
      console.info(`  → Removed ${completed} users from role '${role}' for scope '${scope}'`);
      if (errors > 0) {
        console.warn(`    Errors: ${errors}`);
      }
    } else {
      console.error(`  ✗ Failed to remove users from role '${role}': [${res.status}] ${res.body}`);
    }

    sleep(0.5);
  }

  return { removed: totalRemoved, errors: totalErrors };
}

export function generatePermissionChecks(count, actions, scopes) {
  const permissions = [];
  for (let i = 0; i < count; i++) {
    permissions.push({
      action: actions[i % actions.length],
      scope: scopes[i % scopes.length],
    });
  }
  return permissions;
}

export function validatePermissions(lmsRootUrl, accessToken, config) {
  const url = `${lmsRootUrl}${AUTHZ_PERMISSIONS_VALIDATE_PATH}`;

  const permissions = generatePermissionChecks(
    config.permissionsPerRequest,
    config.actions,
    config.scopes,
  );
  const payload = JSON.stringify(permissions);

  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `JWT ${accessToken}`,
    },
    tags: { name: "ValidatePermissions" },
  };

  const maxRetries = 3;
  const baseDelay = 1000;
  let res;
  let success = false;
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
    res = http.post(url, payload, params);
    const duration = Date.now() - startTime;

    permissionValidationDuration.add(duration);

    success = check(res, {
      "Validate permissions successful": (r) => r.status === 200,
      "Permissions response is array": (r) => {
        if (r.status === 200) {
          try {
            const body = JSON.parse(r.body);
            return Array.isArray(body) && body.length === config.permissionsPerRequest;
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
            return body.every((p) => p.hasOwnProperty("allowed"));
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
        console.debug(`[${res.status}] ${url} - Validated ${config.permissionsPerRequest} permissions in ${duration}ms`);
      }
      break;
    }

    if (attempt < maxRetries) {
      retryCount++;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[${res.status}] ${url} - Retry ${retryCount}/${maxRetries} after ${delay}ms delay`);
      sleep(delay / 1000);
    } else {
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

// --- k6 lifecycle builders ---

export function buildOptions(profile) {
  return {
    stages: profile.stages || [
      { target: 10, duration: "2m" },
      { target: 10, duration: "3m" },
      { target: 25, duration: "2m" },
      { target: 25, duration: "3m" },
      { target: 50, duration: "2m" },
      { target: 50, duration: "4m" },
      { target: 75, duration: "2m" },
      { target: 75, duration: "3m" },
      { target: 100, duration: "2m" },
      { target: 100, duration: "4m" },
      { target: 0, duration: "2m" },
    ],
    thresholds: {
      http_req_failed: ["rate<0.05"],
      http_req_duration: ["p(95)<3000", "p(99)<5000"],
      permission_validation_duration: ["p(95)<2500", "p(99)<5000"],
      permission_validation_errors: ["count<50"],
    },
    noCookiesReset: true,
    summaryTrendStats: ["min", "avg", "med", "max", "p(90)", "p(95)", "p(99)", "p(99.9)"],
    setupTimeout: "20m",
  };
}

export function runSetup(config) {
  const testStartTime = new Date();

  if (!config.runSetup) {
    console.info("Skipping setup phase (run_setup=false)");
    return { users: [], testStartTime: testStartTime.toISOString() };
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`SETUP PHASE: Creating users and assigning ${config.label} roles`);
  console.log("=".repeat(80));
  console.log(`Test start time: ${testStartTime.toISOString()}`);

  const numUsers = exec.instance.vusInitialized;
  console.info(`Creating ${numUsers} test users...`);

  const users = [];
  for (let i = 0; i < numUsers; i++) {
    const user = createTestUser(i, config.lmsRootUrl);
    if (user) {
      users.push(user);
    }
    sleep(1.5);
  }

  console.info(`\n✓ Successfully created ${users.length}/${numUsers} users\n`);

  if (users.length === 0) {
    console.error("✗ SETUP FAILED: No users were created. Aborting test.");
    throw new Error("Setup failed: Unable to create any test users");
  }

  if (users.length < numUsers * 0.5) {
    console.error(`✗ SETUP FAILED: Only ${users.length}/${numUsers} users created (less than 50%). Aborting test.`);
    throw new Error(`Setup failed: Only ${users.length}/${numUsers} users created`);
  }

  console.info("Obtaining admin token for role assignments...");
  const adminToken = getAdminToken(config.lmsRootUrl, config.clientId, config.username, config.password);

  if (!adminToken) {
    console.error("✗ SETUP FAILED: Failed to obtain admin token. Aborting test.");
    throw new Error("Setup failed: Unable to obtain admin authentication token");
  }

  console.info("✓ Admin token obtained\n");

  if (config.cleanupScopes && config.cleanupScopes.length > 0) {
    console.info("Cleaning up existing role assignments before test...\n");

    let cleanupRemoved = 0;
    let cleanupErrors = 0;
    for (const scope of config.cleanupScopes) {
      console.info(`  Cleanup scope: ${scope}`);
      const result = unassignUsersFromRoles(config.lmsRootUrl, adminToken, users, scope, config.roles);
      cleanupRemoved += result.removed;
      cleanupErrors += result.errors;
      sleep(0.5);
    }

    console.info(`\n✓ Pre-test cleanup: ${cleanupRemoved} assignments removed, ${cleanupErrors} errors\n`);
  }

  const assignmentScopes = config.assignmentScopes || config.scopes;
  console.info(`Assigning users to ${config.label} roles across ${assignmentScopes.length} assignment scopes...\n`);

  let totalAssignments = 0;
  let totalErrors = 0;
  for (const scope of assignmentScopes) {
    console.info(`Scope: ${scope}`);
    const result = assignUsersToRoles(config.lmsRootUrl, adminToken, users, scope, config.roles);
    totalAssignments += result.assigned;
    totalErrors += result.errors;
    sleep(1);
  }

  if (totalAssignments === 0) {
    console.error("✗ SETUP FAILED: No role assignments were successful. Aborting test.");
    throw new Error("Setup failed: Unable to assign any roles to users");
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("SETUP COMPLETE");
  console.log("=".repeat(80));
  console.info(`Total users created: ${users.length}`);
  console.info(`Total role assignments: ${totalAssignments}`);
  console.info(`Total assignment errors: ${totalErrors}`);
  console.log(`Roles used: ${config.roles.join(", ")}`);
  console.log(`Assignment scopes: ${assignmentScopes.join(", ")}`);
  console.log(`Validation scopes: ${config.scopes.join(", ")}`);
  console.log(`${"=".repeat(80)}\n`);

  return { users: users, testStartTime: testStartTime.toISOString() };
}

export function runVU(config, data) {
  if (exec.vu.iterationInScenario === 0) {
    const userIndex = exec.vu.idInTest - 1;
    const user = getUser(userIndex);

    console.info(`VU ${exec.vu.idInTest}: Attempting to get token for user: ${user.username}`);
    const accessToken = getAccessToken(config.lmsRootUrl, config.clientId, user.username, user.password);

    if (!accessToken) {
      console.error(`VU ${exec.vu.idInTest} (${user.username}): Failed to obtain access token. Aborting.`);
      console.error(`  User index: ${userIndex}`);
      console.error(`  User email: ${user.email}`);
      exec.vu.tags.token = "failed";
      exec.vu.tags.username = user.username;
      return;
    }

    exec.vu.tags.token = accessToken;
    exec.vu.tags.username = user.username;
    const roleIndex = userIndex % config.roles.length;
    exec.vu.tags.role = config.roles[roleIndex];
    console.info(`VU ${exec.vu.idInTest}: Authenticated as '${user.username}' with role '${config.roles[roleIndex]}'`);
    sleep(1);
  }

  const accessToken = exec.vu.tags.token;

  if (!accessToken || accessToken === "failed") {
    console.error(`VU ${exec.vu.idInTest}: No valid token available. Skipping iteration.`);
    console.error(`  Token value: ${accessToken}`);
    console.error(`  Username: ${exec.vu.tags.username}`);
    console.error(`  Iteration: ${exec.vu.iterationInScenario}`);
    sleep(config.sleepTime);
    return;
  }

  validatePermissions(config.lmsRootUrl, accessToken, config);

  sleep(config.sleepTime);
}

export function runTeardown(config, data) {
  const testEndTime = new Date();

  console.log(`\n${"=".repeat(80)}`);
  console.log(`${config.label.toUpperCase()} PERMISSION VALIDATION PERFORMANCE TEST - SUMMARY`);
  console.log("=".repeat(80));
  console.log(`Test completed for ${config.label} permission validation`);
  console.log(`Permissions validated per request: ${config.permissionsPerRequest}`);
  console.log(`Assignment scopes: ${(config.assignmentScopes || config.scopes).join(", ")}`);
  console.log(`Validation scopes: ${config.scopes.join(", ")}`);

  if (data && data.users) {
    console.log(`\nUser & Role Configuration:`);
    console.log(`  - Total users created: ${data.users.length}`);
    console.log(`  - Roles assigned: ${config.roles.join(", ")}`);
    console.log(`  - Distribution: ${Math.ceil(data.users.length / config.roles.length)} users per role (approx.)`);
  }

  if (data && data.testStartTime) {
    const startTime = new Date(data.testStartTime);
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
  console.log(`  ./run_authz_test.sh authz_small ${config.label === "library" ? "libraries" : "courses"}`);
  console.log(`${"=".repeat(80)}\n`);
}

export function buildHandleSummary(config) {
  return function handleSummary(data) {
    const testEndTime = new Date();

    let grafanaUrl = null;
    const setupData = data.setup_data || {};
    if (setupData.testStartTime) {
      const startTime = new Date(setupData.testStartTime);
      const grafanaStart = new Date(startTime.getTime() - 5 * 60 * 1000);
      const grafanaEnd = new Date(testEndTime.getTime() + 5 * 60 * 1000);

      grafanaUrl = `https://vitals.singapore.edunext.cloud/grafana/d/openedxperformance/open-edx-performance?from=${grafanaStart.toISOString()}&to=${grafanaEnd.toISOString()}&var-resolution=3m&refresh=5m`;
    }

    const thresholdResults = {};
    if (data.metrics) {
      const thresholdMetrics = [
        "http_req_failed",
        "http_req_duration",
        "permission_validation_duration",
        "permission_validation_errors",
      ];

      for (const name of thresholdMetrics) {
        const metric = data.metrics[name];
        if (metric) {
          thresholdResults[name] = {
            values: metric.values,
            thresholds: metric.thresholds,
          };
        }
      }
    }

    const customSummary = {
      ...data,
      grafanaUrl: grafanaUrl,
      testInfo: {
        testType: config.label,
        testStartTime: setupData.testStartTime,
        testEndTime: testEndTime.toISOString(),
        permissionsPerRequest: config.permissionsPerRequest,
        assignmentScopes: config.assignmentScopes || config.scopes,
        validationScopes: config.scopes,
        totalUsers: setupData.users?.length || 0,
        roles: config.roles,
      },
      profileConfig: {
        lms_root_url: config.lmsRootUrl,
        sleep_time: config.sleepTime,
        permissions_per_request: config.permissionsPerRequest,
        run_setup: config.runSetup,
        assignment_scopes: config.assignmentScopes || config.scopes,
        validation_scopes: config.scopes,
        client_id: config.clientId,
      },
      thresholdResults: thresholdResults,
    };

    let thresholdSummary = `\n${"=".repeat(80)}\n`;
    thresholdSummary += `THRESHOLD RESULTS: ${config.label.toUpperCase()}\n`;
    thresholdSummary += `${"=".repeat(80)}\n`;

    for (const [name, info] of Object.entries(thresholdResults)) {
      const vals = info.values || {};
      const thresholds = info.thresholds || {};
      const thresholdEntries = Object.entries(thresholds);

      for (const [criterion, result] of thresholdEntries) {
        const status = result.ok ? "PASS" : "FAIL";
        const marker = result.ok ? "✓" : "✗";

        let actual = "";
        if (name.includes("duration")) {
          actual = `  (p95=${Math.round(vals["p(95)"])}ms, p99=${Math.round(vals["p(99)"])}ms, avg=${Math.round(vals.avg)}ms)`;
        } else if (name.includes("failed")) {
          actual = `  (rate=${(vals.rate * 100).toFixed(2)}%)`;
        } else if (name.includes("errors")) {
          actual = `  (count=${vals.count})`;
        }

        thresholdSummary += `  ${marker} [${status}] ${name}: ${criterion}${actual}\n`;
      }
    }

    thresholdSummary += `${"=".repeat(80)}\n`;

    const output = {
      stdout: textSummary(data, { indent: " ", enableColors: true }) + thresholdSummary,
    };

    const summaryPath = __ENV.SUMMARY_EXPORT;
    if (summaryPath) {
      output[summaryPath] = JSON.stringify(customSummary, null, 2);
    }

    return output;
  };
}

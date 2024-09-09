/*
  Name: Basic LMS load test
  Test type: Load test
  Maintained by: Atlas Team
  Description: This load test uses the K6 http features to execute a basic sequence for multiple users.
    The test requires the definition of an environment variable called "PROFILE" in order to define a
    set of test variables like the LMS url or the course ID used to hit the platform. The list of available
    profiles is contained in the folder ./profiles as JSON files. To run the test against a profile, just
    run the test indicating the profile name (with no extension) as follows:

      $ k6 run <test_file_name>.js -e PROFILE=<profile_name>

    A users.json helper file is used to load real users from the OpenedX platform to perform the test. Every
    user maps to a K6 VU.

    The flow executed by every VU in the test is described below:
    - If the VU (or user) is running its first iteration, try to log the user in.
    - Visit the dashboard page and pause the iteration by <sleepTime> seconds (by default 4)
    - Visit the course catalog page and pause the iteration by <sleepTime> seconds (by default 4)
    - Visit the account settings page and pause the iteration by <sleepTime> seconds (by default 4)
    - Visiting a specific course home and pause the iteration by <sleepTime> seconds (by default 4)
    - Visiting a specific unit of a specific course and pause the iteration by <sleepTime> seconds (by default 4)
*/

/*
  1. INIT CODE
*/

import exec from "k6/execution";
import http from "k6/http";
import { sleep } from "k6";
import { get_profile, createUser, loginUser } from "./utils.js";

const PROFILE = get_profile();

const LMS_ROOT_URL = PROFILE["lms_root_url"];
const MFE_ROOT_URL = PROFILE["learning_mfe_root_url"];
const COURSE_ID = PROFILE["course_id"];;
const LMS_LOGIN_SESSION_PATH = PROFILE["lms_login_session_path"];
const LMS_COURSES_PATH = PROFILE["lms_courses_path"];
const LMS_ACCOUNT_SETTINGS_PATH = PROFILE["lms_account_setting_path"];
const LMS_COURSE_HOME_PATH = `${PROFILE["lms_course_home_path"] + COURSE_ID}/home`;
const LMS_COURSE_UNIT_PATH = PROFILE["course_unit"];
const RUN_SETUP = PROFILE["run_setup"];
const SLEEP_TIME = PROFILE["sleep_time"];

export const options = {
  // This "stages" definition allows to increase the number of VU's gradually through the test.
  stages: PROFILE.stages || [
    { target: 10, duration: "2m" },
    { target: 30, duration: "6m" },
    { target: 0, duration: "2m" },
  ],
  // Cookies are not reset across the iterations of a single VU.
  noCookiesReset: true,
  // Time limit for setup phase.
  setupTimeout: "15m",
  thresholds: {
    "http_req_failed": ["rate<0.01"],
    "http_reqs{status:502}": ["count<1"],
  },
};

/*
  2. SETUP CODE
*/
export function setup() {
  if (!RUN_SETUP){
    return;
  }

  for (let i=0; i<exec.instance.vusInitialized; i++){
    createUser(i, LMS_ROOT_URL, COURSE_ID);
  }
}

/*
  3. VU CODE
*/
export default function (data) {
  // Execute login and enrollment processes only if it's the first iteration of a virtual user.
  // Thanks to the setting "noCookiesReset" cookies are kept across all the iterations
  if (exec.vu.iterationInScenario == 0) {
    loginUser(exec.vu.idInTest - 1, LMS_ROOT_URL, LMS_LOGIN_SESSION_PATH);
  }
  let url = `${LMS_ROOT_URL}/`;
  const lmsRes = http.get(url);
  console.debug(`[${lmsRes.status}] ${url}`);
  sleep(SLEEP_TIME);
  // Visit the course catalog page
  url = LMS_ROOT_URL+LMS_COURSES_PATH;
  const coursesRes = http.get(url);
  console.debug(`[${coursesRes.status}] ${url}`);
  sleep(SLEEP_TIME);
  // Visit the account settings page
  url = LMS_ROOT_URL + LMS_ACCOUNT_SETTINGS_PATH;
  const accountSettingsRes = http.get(url);
  console.debug(`[${accountSettingsRes.status}] ${url}`);
  sleep(SLEEP_TIME);
  // Visiting a specific course home
  url = MFE_ROOT_URL + LMS_COURSE_HOME_PATH;
  const courseHomeRes = http.get(url);
  console.debug(`[${courseHomeRes.status}] ${url}`);
  sleep(SLEEP_TIME);
  // Visiting a specific unit of a specific course
  url = LMS_ROOT_URL + LMS_COURSE_UNIT_PATH;
  const courseUnitRes = http.get(url);
  console.debug(`[${courseUnitRes.status}] ${url}`);
  sleep(SLEEP_TIME);
}

/*
  4. TEARDOWN CODE
*/

export function teardown(data) {}

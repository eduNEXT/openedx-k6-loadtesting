/*
  Name: Problem submit tests.
  Test type: Load test
  Description: used to generate performance indicators when submitting a multiple choice problem in a course.
*/
import exec from "k6/execution";
import http from "k6/http";
import { get_profile, createUser, loginUser } from "./utils.js";

const PROFILE = get_profile();

const LMS_ROOT_URL = PROFILE["lms_root_url"];
const COURSE_ID = PROFILE["course_id"];
const LMS_LOGIN_SESSION_PATH = PROFILE["lms_login_session_path"];
const PROBLEM_ID = PROFILE["problem_id"];
const FULL_PROBLEM_ID = `block-v1:${COURSE_ID.replace('course-v1:', '')}+type@problem+block@${PROBLEM_ID}`;
const XMODULE_HANDLER = `/courses/${COURSE_ID}/xblock/${FULL_PROBLEM_ID}/handler/xmodule_handler/problem_check`;
const PROBLEM_SUBMISSION_BODY = `input_${PROBLEM_ID}_2_1=choice_0`;
const RUN_SETUP = PROFILE["run_setup"] || false;

const client = new Client(PROFILE);

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
  // Visiting a specific unit of a specific course
  const lmsRes = http.get(LMS_ROOT_URL);
  console.debug(`[${lmsRes.status}] ${url}`);
  sleep(SLEEP_TIME);
  // Submit multiple choice problem
  const headers = {
    "x-csrftoken": lmsRes.request.cookies.csrftoken[0].value,
    referer: `${LMS_ROOT_URL}/`,
    credentials: "include",
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
  const submitUnitResponse = http.post(LMS_ROOT_URL + XMODULE_HANDLER, PROBLEM_SUBMISSION_BODY, { headers: headers });
  console.debug(`[${submitUnitResponse.status}] ${url}`);
  sleep(SLEEP_TIME);
}

/*
  4. TEARDOWN CODE
*/

export function teardown(data) {}

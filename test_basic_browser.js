/*
  Name: Basic LMS load test
  Test type: Load test
  Description: This load test uses the K6 browser features to execute a basic sequence for multiple users.
    The sequence is described below:
    - K6 Opens a new page in chromium
    - The user visits the root site url
    - The user clicks the button "Sign in"
    - The user is redirected to the login page where the credentials are filled out
    - Once the user is logged in, the dashboard is loaded
    - The user clicks the button to access s course
    - Once in the course, the user goes directly to a specific unit of the course
    - Once the unit is loaded, K6 closes the web page (session is lost)
  Notes:
    - Browser features are still experimental, so we might experience errors in future versions of K6.
*/

/*
1. INIT CODE
*/
import { check } from "k6";
import { sleep } from "k6";
import { browser } from "k6/experimental/browser";
import exec from "k6/execution";
import { get_profile, getUser, createUser } from "./utils.js";

const PROFILE = get_profile();

const LMS_ROOT_URL = PROFILE["lms_root_url"];
const LEARNING_MFE_ROOT_URL = PROFILE["learning_mfe_root_url"];
const COURSE_ID = PROFILE["course_id"];
const SLEEP_TIME = PROFILE["sleep_time"];
const LMS_COURSE_HOME_PATH = PROFILE["lms_course_home_path"];
const BASIC_BROWSER_TEST_UNIT = PROFILE["basic_browser_test_unit"];

const LMS_COURSE_UNIT_PATH =
  LMS_COURSE_HOME_PATH + COURSE_ID + BASIC_BROWSER_TEST_UNIT;
const RUN_SETUP = PROFILE["run_setup"];

export const options = {
  scenarios: {
    ui: {
      executor: "ramping-vus",
      startVUs: 1,
      stages:  PROFILE.stages || [
        { duration: "5m", target: 20 },
        { duration: "10m", target: 20 },
        { duration: "5m", target: 0 },
      ],
      gracefulRampDown: "0s",
      options: {
        browser: {
          type: "chromium",
        },
      },
    },
  },
  thresholds: {
    checks: ["rate==1.0"],
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

export default async function () {
  const page = browser.newPage();

  try {
    // Visit the site root
    await page.goto(LMS_ROOT_URL);

    // Locate the Signin button and click it
    const signinButton = page.locator('//nav//a[text()="Sign in"]');
    // This will redirect to the login MFE
    await Promise.all([page.waitForNavigation(), signinButton.click()]);
    const currentUser = getUser(exec.vu.idInTest - 1);

    // Fill out user credentials
    if (PROFILE.mfe_enabled){
      page.locator('input[name="emailOrUsername"]').type(currentUser.email);
    }else{
      page.locator('input[name="email"]').type(currentUser.email);
    }
    page.locator('input[name="password"]').type(currentUser.password);
    // Click the login button to be redirected to the dashboard
    const loginButton = page.locator('button[type="submit"]');

    await Promise.all([page.waitForNavigation(), loginButton.click()]);
    sleep(SLEEP_TIME);

    // Quick check to make sure the user is in the dashboard
    check(page, {
      header: (p) =>
        p.locator("h2.header-courses").textContent() == "My Courses",
    });

    // Find the button to go to the course and click it
    const courseLink = page.locator(
      `h3.course-title a[data-course-key="${COURSE_ID}"]`,
    );

    await Promise.all([page.waitForNavigation(), courseLink.click()]);
    sleep(SLEEP_TIME);

    // Go directly to a unit in the course
    await page.goto(LEARNING_MFE_ROOT_URL + LMS_COURSE_UNIT_PATH);
    sleep(SLEEP_TIME);
  } finally {
    page.close();
  }
}

/*
  4. TEARDOWN CODE
*/

// export function teardown(data) {
//   return;
// }

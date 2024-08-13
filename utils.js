import http from "k6/http";
import { URL } from 'https://jslib.k6.io/url/1.0.0/index.js';

function load_profile(profile_path) {
  if (profile_path === undefined) {
    return {};
  }
  let profile = {};
  try{
    profile = JSON.parse(open(profile_path));
  }
  catch(error){
    console.error("Invalid profile file.");
    throw error;
  }
  return profile;
}

function get_profile() {
  const default_profile = load_profile("default.json");
  const profile = load_profile(__ENV.PROFILE);

  return Object.assign(default_profile, profile);
}

function getUser(i){
  return {
    username: `performance__user_${i+1}_browser`,
    email: `performance__user_${i+1}_browser@test.com`,
    password: `password${i+1}`,
    is_active: true,
    redirect: true,
  };
}

function createUser(i, lms_root_url, course_id){
  const user = getUser(i);
  const lmsUrl = new URL(`${lms_root_url}/auto_auth`);
  lmsUrl.searchParams.append('username', user.username);
  lmsUrl.searchParams.append('email', user.email);
  lmsUrl.searchParams.append('password', user.password);
  lmsUrl.searchParams.append('course_id', course_id);
  lmsUrl.searchParams.append('is_active', user.is_active.toString());
  lmsUrl.searchParams.append('redirect', "false");
  const res = http.get(lmsUrl.toString());
  console.info(`Creating user ${user.username}: [${res.status}]`);
  return user;
}

function loginUser(i, lms_root_url, lms_login_session_path){
  // Proceed with the Login
  const user = getUser(i);
  const res = http.get(lms_root_url);
  const csrfToken = res.cookies.csrftoken[0].value;
  const formData = {
    email: user.email,
    password: user.password,
  };
  const headers = {
    "x-csrftoken": csrfToken,
    referer: lms_root_url,
  };

  const loginRes = http.post(lms_root_url + lms_login_session_path, formData, {
    headers: headers,
  });

  console.debug(`[${loginRes.status}] ${lms_login_session_path}`);
}

export { get_profile, createUser, loginUser, getUser };

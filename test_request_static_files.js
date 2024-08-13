import { sleep, group } from "k6";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";
import http from "k6/http";
import { get_profile } from "./utils";

export const options = {
  vus: 100,
  duration: "30s",
};

const PROFILE = get_profile();
const MFE_HOST = PROFILE["mfe_host"];
const MFE_PATH = PROFILE["mfe_path"];

const STATIC_FILES = PROFILE["static_files"];

export default function main() {
  let response;
  const headers = {
    host: `${MFE_HOST}`,
    "user-agent":
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/114.0",
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en,en-US;q=0.8,es;q=0.5,ar-SA;q=0.3",
    "accept-encoding": "gzip, deflate, br",
    dnt: "1",
    connection: "keep-alive",
    "upgrade-insecure-requests": "1",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
  };

  group("MFE static files", function () {
    for (var i = 0; i < STATIC_FILES.length; i++) {
      response = http.get(
        `https://${MFE_HOST}/${MFE_PATH}/${STATIC_FILES[i]}`,
        {
          headers: headers,
        },
      );
    }
  });
  sleep(1);
}

export function handleSummary(data) {
  delete data.metrics["data_sent"];
  delete data.metrics["http_req_blocked"];
  delete data.metrics["iteration_duration"];
  delete data.metrics["http_req_duration{expected_response:true}"];
  delete data.metrics["iterations"];
  delete data.metrics["http_req_connecting"];
  delete data.metrics["http_req_tls_handshaking"];
  delete data.metrics["http_req_sending"];

  const date = new Date().toISOString();
  const run_prefix = __ENV.RUN_NAME || "";
  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }), // Show the text summary to stdout...
    [`${run_prefix}${date}_summary.json`]: JSON.stringify(data, null, 4),
    [`${run_prefix}${date}_summary.txt`]: textSummary(data, {
      indent: " ",
      enableColors: false,
    }),
  };
}

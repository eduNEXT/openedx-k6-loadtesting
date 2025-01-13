#!/bin/bash

mkdir -p ../logs

k6 run ../test_basic_browser.js -e PROFILE=../zach1.json > ../logs/test_basic_browser.log 2>&1 &
k6 run ../test_basic_lms_load.js -e PROFILE=../zach2.json > ../logs/test_basic_lms_load.log 2>&1 &
k6 run ../test_problem_submit_load.js -e PROFILE=../zach3.json > ../logs/test_problem_submit_load.log 2>&1 &
k6 run ../test_request_static_files.js -e PROFILE=../zach4.json > ../logs/test_request_static_files.log 2>&1 &

wait
echo "All tests have been completed. Check the logs in the ../logs folder."

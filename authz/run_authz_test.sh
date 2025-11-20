#!/bin/bash

# Run AuthZ Performance Test with Timestamped Reports
# Usage: ./run_authz_test.sh [profile_name]
# Example: ./run_authz_test.sh authz_small

set -e

# Configuration
PROFILE="${1:-authz_small}"
REPORTS_DIR="reports"
TIMEZONE="Europe/Paris"  # UTC+1 (adjust if needed)

# Create reports directory if it doesn't exist
mkdir -p "$REPORTS_DIR"

# Generate timestamp in UTC+1
TIMESTAMP=$(TZ=$TIMEZONE date +%Y%m%d-%H%M%S)
TEST_ID=$(date +%s)

# Extract profile base name (without path and extension)
PROFILE_NAME=$(basename "$PROFILE" .json)

# Report file paths
JSON_REPORT="${REPORTS_DIR}/authz-${PROFILE_NAME}-${TIMESTAMP}-cet.json"
SUMMARY_REPORT="${REPORTS_DIR}/authz-${PROFILE_NAME}-${TIMESTAMP}-summary.json"
LOG_FILE="${REPORTS_DIR}/authz-${PROFILE_NAME}-${TIMESTAMP}.log"

# Display test information
echo "========================================================================"
echo "AuthZ Performance Test"
echo "========================================================================"
echo "Profile:       profiles/${PROFILE_NAME}.json"
echo "Timestamp:     ${TIMESTAMP} (UTC+1)"
echo "Test ID:       ${TEST_ID}"
echo "JSON Report:   ${JSON_REPORT}"
echo "Summary:       ${SUMMARY_REPORT}"
echo "Log File:      ${LOG_FILE}"
echo "========================================================================"
echo ""

# Run k6 test with timestamped reports
# Capture both stdout and stderr to log file while still displaying to console
k6 run test_authz.js \
  -e PROFILE="$(pwd)/profiles/${PROFILE_NAME}.json" \
  -e SUMMARY_EXPORT="${SUMMARY_REPORT}" \
  --out json="${JSON_REPORT}" \
  --tag testid="${TEST_ID}" \
  --tag profile="${PROFILE_NAME}" \
  --tag timestamp="${TIMESTAMP}" 2>&1 | tee "${LOG_FILE}"

# Display completion message
echo ""
echo "========================================================================"
echo "Test completed successfully!"
echo "========================================================================"
echo "Reports saved:"
echo "  - ${JSON_REPORT}"
echo "  - ${SUMMARY_REPORT}"
echo "  - ${LOG_FILE}"
echo ""
echo "For Grafana, filter by:"
echo "  - Test ID: ${TEST_ID}"
echo "  - Timestamp: ${TIMESTAMP}"
echo "  - Profile: ${PROFILE_NAME}"
echo "========================================================================"

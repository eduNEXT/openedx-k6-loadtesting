#!/bin/bash

# Run AuthZ Performance Test with Timestamped Reports
#
# Usage: ./run_authz_test.sh [profile_name] [test_type] [scope_mode]
#
# Arguments:
#   profile_name  Profile JSON name without extension (default: authz_small)
#   test_type     "courses" or "libraries" (default: libraries)
#   scope_mode    "direct" or "glob" (default: direct)
#
# Environment variables:
#   AUTHZ_USERNAME  Username for admin OAuth2 token (default: admin)
#   AUTHZ_PASSWORD  Password for admin OAuth2 token (default: admin)
#   AUTHZ_CLIENT_ID OAuth2 client ID (default: login-service-client-id)
#
# Examples:
#   ./run_authz_test.sh authz_small libraries
#   ./run_authz_test.sh authz_small courses glob
#   AUTHZ_USERNAME=staff AUTHZ_PASSWORD=secret ./run_authz_test.sh authz_small courses

set -e

# Configuration
PROFILE="${1:-authz_small}"
TEST_TYPE="${2:-libraries}"
SCOPE_MODE="${3:-direct}"
REPORTS_DIR="reports"
TIMEZONE="Europe/Paris"  # UTC+1 (adjust if needed)

# Validate test type
if [[ "$TEST_TYPE" != "libraries" && "$TEST_TYPE" != "courses" ]]; then
  echo "Error: Invalid test type '${TEST_TYPE}'. Must be 'libraries' or 'courses'."
  exit 1
fi

# Validate scope mode
if [[ "$SCOPE_MODE" != "direct" && "$SCOPE_MODE" != "glob" ]]; then
  echo "Error: Invalid scope mode '${SCOPE_MODE}'. Must be 'direct' or 'glob'."
  exit 1
fi

TEST_FILE="test_${TEST_TYPE}.js"

if [[ ! -f "$TEST_FILE" ]]; then
  echo "Error: Test file '${TEST_FILE}' not found."
  exit 1
fi

# Create reports directory if it doesn't exist
mkdir -p "$REPORTS_DIR"

# Generate timestamp in UTC+1
TIMESTAMP=$(TZ=$TIMEZONE date +%Y%m%d-%H%M%S)
TEST_ID=$(date +%s)

# Extract profile base name (without path and extension)
PROFILE_NAME=$(basename "$PROFILE" .json)

# Report file paths
JSON_REPORT="${REPORTS_DIR}/authz-${TEST_TYPE}-${SCOPE_MODE}-${PROFILE_NAME}-${TIMESTAMP}-cet.json"
SUMMARY_REPORT="${REPORTS_DIR}/authz-${TEST_TYPE}-${SCOPE_MODE}-${PROFILE_NAME}-${TIMESTAMP}-summary.json"
LOG_FILE="${REPORTS_DIR}/authz-${TEST_TYPE}-${SCOPE_MODE}-${PROFILE_NAME}-${TIMESTAMP}.log"

# Display test information
echo "========================================================================"
echo "AuthZ Performance Test"
echo "========================================================================"
echo "Test type:     ${TEST_TYPE}"
echo "Scope mode:    ${SCOPE_MODE}"
echo "Test file:     ${TEST_FILE}"
echo "Profile:       profiles/${PROFILE_NAME}.json"
echo "Auth user:     ${AUTHZ_USERNAME:-(default: admin)}"
echo "Timestamp:     ${TIMESTAMP} (UTC+1)"
echo "Test ID:       ${TEST_ID}"
echo "JSON Report:   ${JSON_REPORT}"
echo "Summary:       ${SUMMARY_REPORT}"
echo "Log File:      ${LOG_FILE}"
echo "========================================================================"
echo ""

# Build optional env var flags for k6
ENV_FLAGS=()
[[ -n "${AUTHZ_USERNAME:-}" ]] && ENV_FLAGS+=(-e "AUTHZ_USERNAME=${AUTHZ_USERNAME}")
[[ -n "${AUTHZ_PASSWORD:-}" ]] && ENV_FLAGS+=(-e "AUTHZ_PASSWORD=${AUTHZ_PASSWORD}")
[[ -n "${AUTHZ_CLIENT_ID:-}" ]] && ENV_FLAGS+=(-e "AUTHZ_CLIENT_ID=${AUTHZ_CLIENT_ID}")

# Run k6 test with timestamped reports
# Capture both stdout and stderr to log file while still displaying to console
k6 run "${TEST_FILE}" \
  --quiet \
  -e PROFILE="$(pwd)/profiles/${PROFILE_NAME}.json" \
  -e SCOPE_MODE="${SCOPE_MODE}" \
  -e SUMMARY_EXPORT="${SUMMARY_REPORT}" \
  "${ENV_FLAGS[@]}" \
  --out json="${JSON_REPORT}" \
  --tag testid="${TEST_ID}" \
  --tag profile="${PROFILE_NAME}" \
  --tag testtype="${TEST_TYPE}" \
  --tag scopemode="${SCOPE_MODE}" \
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
echo "  - Test type: ${TEST_TYPE}"
echo "========================================================================"

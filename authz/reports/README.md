# AuthZ Performance Test Reports

This directory contains timestamped performance test reports for the AuthZ library permission validation tests.

## Report Naming Convention

Reports are automatically named with timestamps in UTC+1 (CET) timezone:

```
authz-{profile_name}-{YYYYMMDD-HHMMSS}-cet.json       # Full test data
authz-{profile_name}-{YYYYMMDD-HHMMSS}-summary.json   # Summary metrics
authz-{profile_name}-{YYYYMMDD-HHMMSS}.log            # Console output logs
```

Example:
- `authz-authz_small-20251119-143022-cet.json` - Full test data
- `authz-authz_small-20251119-143022-summary.json` - Summary metrics
- `authz-authz_small-20251119-143022.log` - Console logs with all INFO/DEBUG/ERROR messages

## Running Tests with Automatic Reports

### Using the Helper Script (Recommended)

```bash
# Run with default profile (authz_small)
./run_authz_test.sh

# Run with specific profile
./run_authz_test.sh authz_medium
./run_authz_test.sh authz_large
```

### Manual Execution

```bash
# With UTC+1 timestamp
k6 run test_authz.js \
  -e PROFILE=profiles/authz_medium.json \
  --out json=reports/authz-$(TZ=Europe/Paris date +%Y%m%d-%H%M%S)-cet.json \
  --summary-export=reports/authz-summary-$(TZ=Europe/Paris date +%Y%m%d-%H%M%S).json \
  --tag testid=$(date +%s) \
  --tag profile=authz_medium

# With UTC timestamp
k6 run test_authz.js \
  -e PROFILE=profiles/authz_medium.json \
  --out json=reports/authz-$(date -u +%Y%m%d-%H%M%S)-utc.json
```

## Grafana Dashboard Integration

Reports include tags for easy filtering in Grafana:

- **testid**: Unix timestamp of test start
- **profile**: Profile name (authz_small, authz_medium, authz_large)
- **timestamp**: Human-readable timestamp in UTC+1

### Filtering in Grafana

Use the timestamp from the filename to filter your Grafana dashboard:

1. Filename: `authz-authz_medium-20251119-143022-cet.json`
2. Timestamp: `2025-11-19 14:30:22 UTC+1`
3. In Grafana, set time range around this timestamp

You can also filter by tags:
- `tags.profile = "authz_medium"`
- `tags.testid = "1732024222"`

## Report Contents

### JSON Report
Full granular data for every request:
- Request duration
- Response status
- Custom metrics (permission_validation_duration)
- Tags and metadata

### Summary Report
Aggregated metrics:
- Total requests
- Success/failure rates
- Response time percentiles (p50, p95, p99)
- Custom metric summaries
- Threshold pass/fail status
- Grafana dashboard URL with test time range

### Log File
Complete console output including:
- Setup phase user creation logs
- Role assignment results
- Token acquisition details
- Request/response debugging information
- Error messages and stack traces
- Test summary and completion messages

## Analyzing Reports

### Using jq for Quick Analysis

```bash
# Get test summary
jq '.metrics' reports/authz-*-summary.json

# Count total requests
jq '[.[] | select(.type=="Point")] | length' reports/authz-*-cet.json

# Get all failed requests
jq '[.[] | select(.type=="Point" and .data.tags.status != "200")]' reports/authz-*-cet.json

# Average permission validation duration
jq '[.[] | select(.metric=="permission_validation_duration") | .data.value] | add/length' reports/authz-*-cet.json
```

## Cleanup

To remove old reports:

```bash
# Remove reports older than 30 days
find reports/ -name "authz-*" -mtime +30 -delete

# Remove all reports (use with caution)
rm -f reports/authz-*

# Remove only log files
rm -f reports/authz-*.log
```

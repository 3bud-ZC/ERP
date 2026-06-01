#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://erp.abud.fun}"
LOG_FILE="${LOG_FILE:-/var/log/og-erp-health-monitor.log}"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if curl -fsS "$BASE_URL/api/health" >/dev/null; then
  echo "$ts OK" >> "$LOG_FILE"
else
  echo "$ts FAIL" >> "$LOG_FILE"
  exit 1
fi

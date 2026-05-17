#!/usr/bin/env bash
set -euo pipefail
cd /var/www/erp
ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || echo 'admin@erp.com')"
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2- | tr -d '\r')"
rm -f /tmp/erp-cookie.txt
curl -sf -c /tmp/erp-cookie.txt -X POST "http://127.0.0.1:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" > /tmp/login.json
echo "LOGIN: $(head -c 120 /tmp/login.json)"
DASH="$(curl -s -b /tmp/erp-cookie.txt "http://127.0.0.1:3000/api/dashboard")"
echo "DASHBOARD: $(echo "$DASH" | head -c 300)"
if echo "$DASH" | grep -q '"success":true'; then
  echo "DASHBOARD_TEST_OK"
else
  echo "DASHBOARD_TEST_FAIL"
  exit 1
fi

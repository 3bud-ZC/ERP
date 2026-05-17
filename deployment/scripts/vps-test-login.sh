#!/usr/bin/env bash
set -euo pipefail
cd /var/www/erp
ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || echo 'admin@erp.com')"
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2- | tr -d '\r')"
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "LOGIN_TEST_FAIL: ADMIN_PASSWORD not in .env"
  exit 1
fi
RES="$(curl -s -w "\nHTTP:%{http_code}" -X POST "http://127.0.0.1:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")"
CODE="$(echo "$RES" | grep HTTP: | cut -d: -f2)"
BODY="$(echo "$RES" | grep -v HTTP:)"
echo "HTTP_CODE=$CODE"
echo "$BODY" | head -c 400
if echo "$BODY" | grep -q '"success":true'; then
  echo ""
  echo "LOGIN_TEST_OK"
  exit 0
fi
echo ""
echo "LOGIN_TEST_FAIL"
exit 1

#!/usr/bin/env bash
set -euo pipefail
cd /var/www/erp
ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || echo 'admin@erp.com')"
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2- | tr -d '\r')"
rm -f /tmp/erp-https-cookie.txt
curl -sf -c /tmp/erp-https-cookie.txt -X POST "https://erp-abud.com/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}"
echo ""
if grep -q token /tmp/erp-https-cookie.txt 2>/dev/null; then
  echo "HTTPS_COOKIE_OK"
else
  echo "HTTPS_COOKIE_WARN: no token cookie in jar (check Secure/SameSite)"
fi
DASH="$(curl -sf -b /tmp/erp-https-cookie.txt "https://erp-abud.com/api/dashboard")"
echo "DASHBOARD: $(echo "$DASH" | head -c 200)"
echo "HTTPS_LOGIN_DASHBOARD_OK"

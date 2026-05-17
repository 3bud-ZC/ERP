#!/usr/bin/env bash
set -euo pipefail
cd /var/www/erp
ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || echo 'admin@erp.com')"
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2- | tr -d '\r')"
DOMAIN="og-estore.site"
rm -f /tmp/erp-og-cookie.txt
LOGIN="$(curl -s -w "\nHTTP:%{http_code}" -c /tmp/erp-og-cookie.txt -X POST "https://${DOMAIN}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")"
echo "$LOGIN" | grep -v HTTP: | head -c 250
CODE="$(echo "$LOGIN" | grep HTTP: | cut -d: -f2)"
echo ""
echo "LOGIN_HTTP=$CODE"
if [ "$CODE" != "200" ]; then exit 1; fi
if grep -qi token /tmp/erp-og-cookie.txt; then echo "COOKIE_OK"; else echo "COOKIE_FAIL"; exit 1; fi
DASH="$(curl -sf -b /tmp/erp-og-cookie.txt "https://${DOMAIN}/api/dashboard")"
echo "DASHBOARD=$(echo "$DASH" | head -c 180)"
echo "HTTPS_VALIDATION_OK"

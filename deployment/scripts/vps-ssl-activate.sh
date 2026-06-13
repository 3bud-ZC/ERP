#!/usr/bin/env bash
# Final HTTPS + SSL activation for erp.abud.fun
set -euo pipefail

DOMAIN="erp.abud.fun"
WWW="www.erp.abud.fun"
TARGET_IP="167.99.157.6"
ERP_DIR="/var/www/erp"
EMAIL="${CERTBOT_EMAIL:-admin@erp.abud.fun}"
LOG="/tmp/erp-ssl-activate-$(date +%Y%m%d_%H%M%S).log"

exec > >(tee -a "$LOG") 2>&1

resolve_a() {
  local host="$1"
  if command -v dig >/dev/null 2>&1; then
    dig +short A "$host" @8.8.8.8 | tr -d '\r' | grep -E '^[0-9.]+$' || true
  else
    getent ahosts "$host" | awk '{print $1}' | head -1
  fi
}

echo "=== PHASE 1: DNS VALIDATION ==="
MAX_TRIES=20
SLEEP_SECS=15
dns_ok=false

for attempt in $(seq 1 $MAX_TRIES); do
  echo "--- DNS attempt $attempt/$MAX_TRIES ---"
  ok=true
  for h in "$DOMAIN" "$WWW"; do
    ips="$(resolve_a "$h")"
    echo "$h -> ${ips:-NO_RECORD}"
    if [ -z "$ips" ] || ! echo "$ips" | grep -qx "$TARGET_IP"; then
      ok=false
    fi
  done
  if $ok; then
    dns_ok=true
    echo "DNS_OK: both hosts resolve to $TARGET_IP"
    break
  fi
  if [ "$attempt" -lt "$MAX_TRIES" ]; then
    sleep "$SLEEP_SECS"
  fi
done

if ! $dns_ok; then
  echo "DNS_FAIL: records not ready after $MAX_TRIES attempts"
  exit 1
fi

ping -c 2 "$DOMAIN" || true

echo "=== PHASE 2: SSL ISSUANCE ==="
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq certbot python3-certbot-nginx
fi

nginx -t

# Stop auto-certbot if running to avoid race during issuance
if systemctl is-active --quiet auto-certbot 2>/dev/null; then
  systemctl stop auto-certbot || true
fi

certbot --nginx \
  -d "$DOMAIN" \
  -d "$WWW" \
  --redirect \
  --non-interactive \
  --agree-tos \
  --no-eff-email \
  --email "$EMAIL"

echo "=== Certificate list ==="
certbot certificates

echo "=== Renewal dry-run ==="
certbot renew --dry-run

echo "=== PHASE 3: ENVIRONMENT UPDATE ==="
ENV_FILE="$ERP_DIR/.env"
cp -a "$ENV_FILE" "$ERP_DIR/backups/recovery/.env.pre-ssl-$(date +%Y%m%d_%H%M%S)"

update_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

update_env "NEXTAUTH_URL" "https://${DOMAIN}"
update_env "NEXT_PUBLIC_API_URL" "https://${DOMAIN}/api"

echo "ENV updated (keys only):"
grep -E '^(NEXTAUTH_URL|NEXT_PUBLIC_API_URL)=' "$ENV_FILE" | cut -d= -f1

echo "=== PHASE 4: SERVICE RESTART ==="
systemctl restart erp-system
systemctl restart nginx
sleep 6
systemctl is-active erp-system
systemctl is-active nginx

echo "=== PHASE 5: VALIDATION ==="
echo "--- HTTP redirect ---"
curl -sI "http://${DOMAIN}/" | head -8

echo "--- HTTPS health ---"
curl -sSf "https://${DOMAIN}/api/health" | head -c 400
echo ""

echo "--- HTTPS system status ---"
curl -sSf "https://${DOMAIN}/api/system/status" | head -c 400
echo ""

echo "--- TLS cert subject ---"
echo | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null \
  | openssl x509 -noout -subject -dates 2>/dev/null || true

echo "--- Login test (localhost via HTTPS proxy) ---"
bash /tmp/vps-test-login-https.sh 2>/dev/null || bash /tmp/vps-test-login.sh

echo "=== SSL activation complete. Log: $LOG ==="

#!/usr/bin/env bash
# Primary domain migration + SSL for erp.abud.fun
set -euo pipefail

DOMAIN="erp.abud.fun"
WWW="www.erp.abud.fun"
TARGET_IP="167.99.157.6"
ERP_DIR="/var/www/erp"
EMAIL="${CERTBOT_EMAIL:-admin@${DOMAIN}}"
NGINX_SITE="/etc/nginx/sites-available/erp"
LOG="/tmp/erp-domain-migrate-$(date +%Y%m%d_%H%M%S).log"

exec > >(tee -a "$LOG") 2>&1

resolve_a() {
  dig +short A "$1" @8.8.8.8 2>/dev/null | tr -d '\r' | grep -E '^[0-9.]+$' | head -1 || true
}

echo "=== PHASE 1: DNS VALIDATION ==="
MAX_TRIES=30
SLEEP_SECS=20
dns_ok=false

for attempt in $(seq 1 $MAX_TRIES); do
  echo "--- attempt $attempt/$MAX_TRIES ---"
  ok=true
  for h in "$DOMAIN" "$WWW"; do
    ip="$(resolve_a "$h")"
    echo "$h -> ${ip:-NXDOMAIN}"
    [ "$ip" = "$TARGET_IP" ] || ok=false
  done
  if $ok; then dns_ok=true; break; fi
  [ "$attempt" -lt "$MAX_TRIES" ] && sleep "$SLEEP_SECS"
done

if ! $dns_ok; then
  echo "DNS_FAIL"
  exit 1
fi
echo "DNS_OK"

echo "=== PHASE 2: NGINX CONFIGURATION ==="
cp -a "$NGINX_SITE" "${NGINX_SITE}.bak-$(date +%Y%m%d_%H%M%S)"

cat > "$NGINX_SITE" <<'NGINX_HTTP'
server {
    listen 80;
    listen [::]:80;
    server_name erp.abud.fun www.erp.abud.fun;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_buffering off;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_redirect off;
    }
}
NGINX_HTTP

# Remove default_server from old configs if present
sed -i 's/ default_server//g' /etc/nginx/sites-available/default 2>/dev/null || true

nginx -t
systemctl reload nginx

echo "=== PHASE 3: SSL ISSUANCE ==="
systemctl stop auto-certbot 2>/dev/null || true
systemctl stop erp-ssl-wait 2>/dev/null || true
systemctl disable erp-ssl-wait 2>/dev/null || true

if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# www -> apex redirect preference: certbot --redirect handles http->https;
# add explicit www redirect in nginx after certbot if needed
certbot --nginx \
  -d "$DOMAIN" \
  -d "$WWW" \
  --redirect \
  --non-interactive \
  --agree-tos \
  --no-eff-email \
  --email "$EMAIL"

certbot certificates
certbot renew --dry-run

echo "=== PHASE 4: ENV UPDATE ==="
ENV_FILE="$ERP_DIR/.env"
cp -a "$ENV_FILE" "$ERP_DIR/backups/recovery/.env.pre-og-estore-$(date +%Y%m%d_%H%M%S)"

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

grep -E '^(NEXTAUTH_URL|NEXT_PUBLIC_API_URL)=' "$ENV_FILE" | cut -d= -f1

echo "=== PHASE 5: RESTART ==="
systemctl restart erp-system
systemctl restart nginx
sleep 6
systemctl is-active erp-system
systemctl is-active nginx

echo "=== PHASE 6: VALIDATION ==="
echo "--- HTTP -> HTTPS ---"
curl -sI "http://${DOMAIN}/" | head -6
echo "--- HTTPS health ---"
curl -sSf "https://${DOMAIN}/api/health" | head -c 350
echo ""
echo "--- HTTPS status ---"
curl -sSf "https://${DOMAIN}/api/system/status" | head -c 350
echo ""
echo "--- TLS ---"
echo | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates 2>/dev/null || true

echo "--- Login + cookie ---"
bash /tmp/vps-test-login-og.sh

echo "=== MIGRATION COMPLETE: $LOG ==="

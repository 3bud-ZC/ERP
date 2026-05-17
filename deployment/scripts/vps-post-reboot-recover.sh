#!/usr/bin/env bash
# Run ON THE VPS (as root) after reboot/update when SSH works again.
# Restores ERP stack without touching database data.
set -euo pipefail

ERP_DIR="/var/www/erp"
DOMAIN="og-estore.site"
LOG="/tmp/erp-post-reboot-$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

echo "=== ERP POST-REBOOT RECOVERY ==="
date -Is

# Backup
mkdir -p "$ERP_DIR/backups/recovery"
[ -f "$ERP_DIR/.env" ] && cp -a "$ERP_DIR/.env" "$ERP_DIR/backups/recovery/.env.pre-reboot-$(date +%Y%m%d_%H%M%S)"
[ -f /etc/nginx/sites-available/erp ] && cp -a /etc/nginx/sites-available/erp "$ERP_DIR/backups/recovery/nginx-erp-$(date +%Y%m%d_%H%M%S)"

echo "=== 1. Firewall (common post-update breakage) ==="
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
  ufw allow 22/tcp || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi

echo "=== 2. PostgreSQL ==="
systemctl start postgresql 2>/dev/null || systemctl start postgresql@* 2>/dev/null || true
systemctl is-active postgresql 2>/dev/null || systemctl is-active postgresql@* 2>/dev/null || echo "WARN: postgres service name may differ"

echo "=== 3. Env sanity (names only) ==="
for k in NODE_ENV DATABASE_URL JWT_SECRET NEXTAUTH_URL NEXT_PUBLIC_API_URL; do
  if grep -qE "^${k}=" "$ERP_DIR/.env" 2>/dev/null; then
    if [ "$k" = JWT_SECRET ]; then
      len=$(grep "^JWT_SECRET=" "$ERP_DIR/.env" | cut -d= -f2- | wc -c)
      echo "OK $k (len check)"
    else
      echo "OK $k"
    fi
  else
    echo "MISSING $k"
  fi
done

echo "=== 4. Nginx ==="
nginx -t
systemctl enable nginx
systemctl restart nginx
systemctl is-active nginx

echo "=== 5. ERP application ==="
systemctl enable erp-system
cd "$ERP_DIR"
# Ensure .next exists; rebuild only if missing
if [ ! -f "$ERP_DIR/.next/BUILD_ID" ]; then
  echo "BUILD_ID missing — running production build..."
  sudo -u erp npm run build
fi
systemctl restart erp-system
sleep 8
systemctl is-active erp-system

echo "=== 6. Listeners ==="
ss -tlnp | grep -E ':80|:443|:3000' || true

echo "=== 7. Local health ==="
curl -sf "http://127.0.0.1:3000/api/health" | head -c 400 || echo "APP_HEALTH_FAIL"
echo ""
curl -sfI -H "Host: $DOMAIN" "http://127.0.0.1/api/health" | head -5 || echo "NGINX_PROXY_FAIL"

echo "=== 8. HTTPS / cert ==="
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot certificates 2>/dev/null | grep -A2 "$DOMAIN" || true
else
  echo "WARN: no cert for $DOMAIN"
fi

echo "=== 9. Recent errors ==="
journalctl -u erp-system -n 15 --no-pager 2>/dev/null || true
tail -5 /var/log/nginx/error.log 2>/dev/null || true

echo "=== RECOVERY LOG: $LOG ==="

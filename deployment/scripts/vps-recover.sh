#!/usr/bin/env bash
# ERP production recovery — run on VPS as root
set -euo pipefail

ERP_DIR="${ERP_DIR:-/var/www/erp}"
DOMAIN="${DOMAIN:-erp-abud.com}"
STAMP="$(date +%Y%m%d_%H%M%S)"
LOG="/tmp/erp-recover-${STAMP}.log"

exec > >(tee -a "$LOG") 2>&1

echo "=== ERP Recovery ${STAMP} ==="
echo "ERP_DIR=$ERP_DIR"

cd "$ERP_DIR"

# --- Backups ---
mkdir -p backups/recovery
cp -a middleware.ts "backups/recovery/middleware.ts.${STAMP}" 2>/dev/null || true
cp -a .env "backups/recovery/.env.${STAMP}" 2>/dev/null || true

# --- Env validation (no secret values printed) ---
check_env() {
  local key="$1" min="${2:-1}"
  local val
  val="$(grep -E "^${key}=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
  if [ -z "$val" ]; then
    echo "ENV_FAIL: ${key} is missing"
    return 1
  fi
  if [ "$min" -gt 1 ] && [ "${#val}" -lt "$min" ]; then
    echo "ENV_FAIL: ${key} length ${#val} < ${min}"
    return 1
  fi
  echo "ENV_OK: ${key}"
  return 0
}

check_env NODE_ENV 1
check_env DATABASE_URL 10
check_env JWT_SECRET 32
check_env SETUP_TOKEN 16
check_env NEXTAUTH_URL 10

if ! grep -q "erp-abud.com" .env 2>/dev/null; then
  echo "WARN: NEXTAUTH_URL may not match production domain"
fi

# --- Migrations ---
echo "=== Prisma migrate deploy ==="
sudo -u erp npx prisma migrate deploy

echo "=== Verify SystemSettings table ==="
sudo -u postgres psql -d erp_system_prod -t -A -c \
  "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='SystemSettings');"

# --- Build ---
echo "=== Production build ==="
sudo -u erp npm run build

# --- Restart app ---
echo "=== Restart erp-system ==="
systemctl restart erp-system
sleep 8
systemctl is-active erp-system

# --- Local API checks ---
echo "=== GET /api/system/status ==="
curl -sf "http://127.0.0.1:3000/api/system/status" | head -c 500 || echo "status check failed"
echo ""

echo "=== GET /api/init ==="
curl -sf "http://127.0.0.1:3000/api/init" | head -c 500 || echo "init GET failed"
echo ""

STATE="$(curl -sf "http://127.0.0.1:3000/api/system/status" | grep -o '"state":"[^"]*"' | head -1 || true)"
echo "Detected: ${STATE:-unknown}"

if echo "$STATE" | grep -q UNINITIALIZED; then
  echo "=== POST /api/init (bootstrap) ==="
  SETUP_TOKEN="$(grep -E '^SETUP_TOKEN=' .env | cut -d= -f2- | tr -d '\r')"
  INIT_RES="$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "http://127.0.0.1:3000/api/init" \
    -H "Authorization: Bearer ${SETUP_TOKEN}" \
    -H "Content-Type: application/json")"
  echo "$INIT_RES" | head -c 800
  echo ""
fi

echo "=== Public HTTPS check ==="
curl -sfI "https://${DOMAIN}/api/health" | head -5 || echo "HTTPS health failed"

echo "=== Recovery log: $LOG ==="

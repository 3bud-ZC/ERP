#!/usr/bin/env bash
# Sync local project to VPS (tarball, preserves server .env). Run from repo root.
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@159.223.167.220}"
ERP_DIR="${ERP_DIR:-/var/www/erp}"
ARCHIVE="/tmp/erp-sync-$(date +%Y%m%d%H%M).tar.gz"

tar -czf "$ARCHIVE" \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=.git \
  --exclude=.env \
  --exclude='.env.*' \
  --exclude=artifacts \
  --exclude=test-results \
  --exclude=outputs \
  --exclude=backups \
  --exclude='*.log' \
  --exclude=.cursor \
  -C "$(dirname "$(dirname "$(dirname "$0")")")")" .

scp "$ARCHIVE" "${VPS_HOST}:/tmp/erp-sync.tar.gz"

ssh "$VPS_HOST" "bash -s" <<REMOTE
set -euo pipefail
BACKUP_DIR=/var/www/backups/erp-pre-sync-\$(date +%Y%m%d-%H%M%S)
mkdir -p "\$BACKUP_DIR"
cp -a ${ERP_DIR}/.env "\$BACKUP_DIR/.env" 2>/dev/null || true
cd ${ERP_DIR}
tar -xzf /tmp/erp-sync.tar.gz
chown -R erp:erp ${ERP_DIR}
sudo -u erp bash -c '
  set -euo pipefail
  cd ${ERP_DIR}
  npm ci
  npx prisma generate
  npx prisma migrate deploy
  npm run build
  mkdir -p .next/standalone/.next
  rm -rf .next/standalone/.next/static .next/standalone/public
  cp -a .next/static .next/standalone/.next/static
  [ -d public ] && cp -a public .next/standalone/public || true
'
systemctl restart erp-system
sleep 3
curl -sf http://127.0.0.1:3000/api/health
echo ""
REMOTE

echo "SYNC COMPLETE -> ${VPS_HOST}"

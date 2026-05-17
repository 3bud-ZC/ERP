#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/var/www/erp}
WORKDIR=${WORKDIR:-$APP_DIR}

echo "=== ERP Update Script ==="
cd "$WORKDIR"

if [ ! -d .git ]; then
  echo "Error: $WORKDIR is not a git repository."
  exit 1
fi

git fetch --all --prune
git pull --ff-only

echo "Installing dependencies..."
npm ci

echo "Generating Prisma client..."
npx prisma generate

echo "Applying migrations..."
npx prisma migrate deploy

echo "Building application..."
npm run build

if command -v pm2 >/dev/null && pm2 describe erp-system >/dev/null 2>&1; then
  echo "Reloading PM2 app..."
  pm2 reload ecosystem.config.js --env production
else
  echo "Restarting systemd service..."
  systemctl restart erp-system.service
fi

echo "UPDATE COMPLETE."

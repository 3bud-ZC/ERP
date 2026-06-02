#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/var/www/erp}
WORKDIR=${WORKDIR:-$APP_DIR/current}
PM2_APP=${PM2_APP:-erp-system}

echo "=== ERP Update Script ==="
if [ ! -d "$WORKDIR" ]; then
  WORKDIR="$APP_DIR"
fi

cd "$WORKDIR"

if [ ! -d .git ]; then
  echo "Warning: $WORKDIR is not a git repository. Skipping git pull."
else
  git fetch --all --prune
  git pull --ff-only
fi

echo "Installing dependencies..."
npm ci --no-audit --no-fund

echo "Generating Prisma client..."
npx prisma generate

echo "Applying migrations..."
npx prisma migrate deploy

echo "Building application..."
npm run build

if command -v pm2 >/dev/null && pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  echo "Reloading PM2 app..."
  pm2 reload "$PM2_APP" --update-env
else
  echo "Restarting systemd service..."
  systemctl restart erp-system.service
fi

echo "UPDATE COMPLETE."

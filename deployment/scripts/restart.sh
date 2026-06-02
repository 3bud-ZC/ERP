#!/usr/bin/env bash
set -euo pipefail

PM2_APP=${PM2_APP:-erp-system}

echo "=== ERP Restart Script ==="

if command -v pm2 >/dev/null && pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  echo "Restarting PM2 process..."
  pm2 restart "$PM2_APP" --update-env
elif systemctl list-units --full -all | grep -q '^erp-system.service'; then
  echo "Restarting systemd service..."
  systemctl restart erp-system.service
else
  echo "No recognized ERP service found."
  exit 1
fi

echo "RESTART COMPLETE."

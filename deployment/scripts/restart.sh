#!/usr/bin/env bash
set -euo pipefail

echo "=== ERP Restart Script ==="

if command -v pm2 >/dev/null && pm2 describe erp-system >/dev/null 2>&1; then
  echo "Restarting PM2 process..."
  pm2 restart erp-system
elif systemctl list-units --full -all | grep -q '^erp-system.service'; then
  echo "Restarting systemd service..."
  systemctl restart erp-system.service
else
  echo "No recognized ERP service found."
  exit 1
fi

echo "RESTART COMPLETE."

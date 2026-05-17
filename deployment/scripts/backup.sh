#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/var/www/erp}
BACKUP_DIR=${BACKUP_DIR:-$APP_DIR/backups}

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

echo "=== ERP Backup Script ==="
BACKUP_DIR="$BACKUP_DIR" npm run backup

echo "BACKUP COMPLETE."

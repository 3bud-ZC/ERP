#!/usr/bin/env bash
set -euo pipefail

DB_PASS=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')
NEXTAUTH_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER erp_prod_user WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER erp_prod_user WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE erp_system_prod OWNER erp_prod_user;" 2>/dev/null || true
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE erp_system_prod TO erp_prod_user;"

CONF=/etc/postgresql/16/main/postgresql.conf
HBA=/etc/postgresql/16/main/pg_hba.conf

if ! grep -q "^listen_addresses = 'localhost'" "$CONF"; then
  sed -i "s/^#listen_addresses = 'localhost'/listen_addresses = 'localhost'/" "$CONF" || true
  grep -q "^listen_addresses = 'localhost'" "$CONF" || echo "listen_addresses = 'localhost'" >> "$CONF"
fi

sed -i "s/^host all all 0\.0\.0\.0\/0.*$/# disabled public access/" "$HBA" || true
if ! grep -q "^host all all 127.0.0.1/32 scram-sha-256" "$HBA"; then
  echo "host all all 127.0.0.1/32 scram-sha-256" >> "$HBA"
fi

systemctl restart postgresql

cat > /var/www/erp/.env <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://erp_prod_user:$DB_PASS@127.0.0.1:5432/erp_system_prod?schema=public
JWT_SECRET=$JWT_SECRET
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
NEXTAUTH_URL=https://erp.abud.fun
NEXT_PUBLIC_API_URL=https://erp.abud.fun/api
NEXT_TELEMETRY_DISABLED=1
ALLOW_SEED=false
E2E_BYPASS_RATE_LIMIT=0
E2E_ALLOW_AUTH_RESET=0
E2E_ALLOW_PRODUCTION_DB=0
BACKUP_DIR=./backups
EOF
chmod 640 /var/www/erp/.env
chown erp:erp /var/www/erp/.env

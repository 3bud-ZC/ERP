#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/var/www/erp}
APP_USER=${APP_USER:-erp}
APP_GROUP=${APP_GROUP:-erp}
NODE_VERSION=${NODE_VERSION:-20}

echo "=== ERP VPS Install Script ==="

echo "Creating app user and directories..."
if ! id "$APP_USER" >/dev/null 2>&1; then
  groupadd --system "$APP_GROUP"
  useradd --system --gid "$APP_GROUP" --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/logs"
mkdir -p "$APP_DIR/backups"
chown -R "$APP_USER":"$APP_GROUP" "$APP_DIR"

echo "Installing system packages..."
apt-get update
apt-get install -y curl ca-certificates gnupg lsb-release nginx ufw git postgresql-client certbot python3-certbot-nginx

if ! command -v node >/dev/null; then
  echo "Installing Node.js $NODE_VERSION..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null; then
  echo "Installing PM2..."
  npm install -g pm2
fi

echo "Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "Enabling Nginx..."
systemctl enable nginx
systemctl restart nginx

cat <<'EOF'

INSTALL COMPLETE.
- Copy application files to $APP_DIR
- Create .env from deployment/.env.production.example
- Copy deployment/nginx.conf to /etc/nginx/nginx.conf
- Update server_name and SSL certificate paths
- Choose PM2 or systemd to start the app
EOF

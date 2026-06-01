#!/bin/bash
set -e

RELEASE_TAG=$(date +%Y%m%d%H%M%S)
RELEASE_DIR=/var/www/og-erp/releases/${RELEASE_TAG}
echo "Creating release directory: $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

echo "Extracting tarball..."
tar -xzf /tmp/og-erp.tgz -C "$RELEASE_DIR"

echo "Copying .env file..."
cp /var/www/og-erp/current/.env "$RELEASE_DIR/.env"

cd "$RELEASE_DIR"

echo "Installing dependencies..."
npm install

echo "Generating Prisma client..."
npx prisma generate

echo "Deploying migrations..."
npx prisma migrate deploy

echo "Building project..."
npm run build

echo "Updating symlink..."
ln -sfn "$RELEASE_DIR" /var/www/og-erp/current

echo "Removing any bundled .env.production to prevent overriding server secrets..."
rm -f /var/www/og-erp/current/.env.production

echo "Restarting PM2 cleanly..."
cd /var/www/og-erp/current
pm2 delete og-erp || true
PORT=3100 pm2 start npm --name og-erp -- start
pm2 save

echo "Running post-deploy smoke checks..."
bash /var/www/og-erp/current/deployment/scripts/post-deploy-smoke.sh https://erp.abud.fun

echo "Deployment successful!"

RELEASE_TAG=20260527190500
RELEASE_DIR=/var/www/og-erp/releases/$RELEASE_TAG
mkdir -p $RELEASE_DIR
tar -xzf /tmp/og-erp.tgz -C $RELEASE_DIR
cp /var/www/og-erp/current/.env $RELEASE_DIR/.env
cd $RELEASE_DIR
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
echo $RELEASE_DIR > /tmp/latest_release.txt

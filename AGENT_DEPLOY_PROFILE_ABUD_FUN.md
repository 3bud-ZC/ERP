# AGENT DEPLOY PROFILE — ABUD FUN VPS

هذا الملف يُرسل لأي AI Agent لتنفيذ نشر مشروع جديد على السيرفر مباشرة بدون شرح إضافي.

## 1) Server Access
- Server IP: `167.99.157.6`
- SSH User: `root`
- OS: Ubuntu Linux
- Web Server: Nginx
- Process Manager: PM2
- PostgreSQL: محلي على نفس السيرفر

> استخدم SSH المباشر. لا تستخدم GitHub pull للنشر.

---

## 2) Critical Safety Rules (Mandatory)
1. **ممنوع تعديل أو إيقاف أي خدمة موجودة** إلا إذا طلبت أنا ذلك صراحة.
2. **ممنوع لمس** أي مشروع إنتاج قائم إلا المشروع الجديد المطلوب نشره.
3. النشر يكون من ملفات المشروع الحالية (tar/scp/rsync) — **بدون** `git pull`.
4. لا تحذف `.env` الخاص بالمشاريع القائمة.
5. قبل أي تغيير: خذ backup للـNginx config والـDB المستهدفة.

---

## 3) Target Pattern for New Projects
- App Name: `<app_name>`
- Domain: `<app_name>.abud.fun`
- Project Path: `/var/www/<app_name>`
- Releases Path: `/var/www/<app_name>/releases/<timestamp>`
- Current Symlink: `/var/www/<app_name>/current`
- PM2 Process Name: `<app_name>`
- Internal Port: اختر بورت غير مستخدم (مثال: `3110`, `3120`, ...)

---

## 4) Required Inputs Before Deploy
لا تبدأ إلا بعد توفر القيم التالية:
- `APP_NAME`
- `DOMAIN`
- `PORT`
- `DATABASE_NAME`
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `LOCAL_TARBALL_PATH` (نسخة المشروع المضغوطة)
- `ENV_VALUES` (المتغيرات المطلوبة للمشروع)

---

## 5) Deployment Steps (Standard)

### Step A — Create app directories
```bash
mkdir -p /var/www/${APP_NAME}/releases /var/www/${APP_NAME}/shared/logs /var/www/${APP_NAME}/shared/backups
```

### Step B — Create PostgreSQL DB/User
```bash
sudo -u postgres psql -c "CREATE ROLE ${DATABASE_USER} LOGIN PASSWORD '${DATABASE_PASSWORD}';" || true
sudo -u postgres psql -c "ALTER ROLE ${DATABASE_USER} WITH PASSWORD '${DATABASE_PASSWORD}';"
sudo -u postgres createdb -O ${DATABASE_USER} ${DATABASE_NAME} || true
```

### Step C — Upload source tarball
من الجهاز المحلي:
```bash
scp <LOCAL_TARBALL_PATH> root@167.99.157.6:/tmp/${APP_NAME}.tgz
```

### Step D — Extract release
```bash
RELEASE_TAG=$(date +%Y%m%d%H%M%S)
RELEASE_DIR=/var/www/${APP_NAME}/releases/${RELEASE_TAG}
mkdir -p "$RELEASE_DIR"
tar -xzf /tmp/${APP_NAME}.tgz -C "$RELEASE_DIR"
```

### Step E — Write `.env` for this app
```bash
cat > "${RELEASE_DIR}/.env" <<EOF
NODE_ENV=production
PORT=${PORT}
DATABASE_URL=postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@127.0.0.1:5432/${DATABASE_NAME}?schema=public
# ضع باقي ENV حسب المشروع:
# JWT_SECRET=...
# NEXTAUTH_SECRET=...
# NEXTAUTH_URL=https://${DOMAIN}
EOF
```

### Step F — Install/build/migrate
```bash
cd "$RELEASE_DIR"
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
```

### Step G — PM2 start/restart
```bash
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 delete "${APP_NAME}" || true
fi
PORT=${PORT} pm2 start npm --name "${APP_NAME}" -- start
pm2 save
ln -sfn "$RELEASE_DIR" /var/www/${APP_NAME}/current
```

### Step H — Nginx site
```bash
cat > /etc/nginx/sites-available/${DOMAIN} <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};

  location / {
    proxy_pass http://127.0.0.1:${PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
EOF

ln -sfn /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}
nginx -t
systemctl reload nginx
```

### Step I — SSL
```bash
certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --register-unsafely-without-email --redirect
systemctl reload nginx
```

### Step J — Health checks
```bash
curl -I http://127.0.0.1:${PORT}
curl -I https://${DOMAIN}
curl -I https://${DOMAIN}/api/health
pm2 status ${APP_NAME}
```

---

## 6) Rollback (If deploy fails)
1. ارجع symlink إلى release أقدم:
```bash
ln -sfn /var/www/${APP_NAME}/releases/<old_release_tag> /var/www/${APP_NAME}/current
```
2. أعد تشغيل PM2:
```bash
pm2 restart ${APP_NAME}
```
3. تحقق:
```bash
curl -I https://${DOMAIN}/api/health
```

---

## 7) Ready-to-send Prompt to Any AI Agent
انسخ هذا النص كما هو:

> Deploy this project to my VPS using `AGENT_DEPLOY_PROFILE_ABUD_FUN.md` exactly.  
> Use local files as source-of-truth (tar/scp), no git pull.  
> Create isolated app path, isolated DB/user, isolated PM2 process, isolated Nginx vhost on `<app_name>.abud.fun`, enable SSL, run migrate/build, and return final health-check output.

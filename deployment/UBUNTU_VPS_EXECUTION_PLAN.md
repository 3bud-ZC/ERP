# Ubuntu VPS Execution Plan

This plan is for deploying the ERP system on a fresh Ubuntu VPS without performing the deployment yet.

## Prerequisites
- Ubuntu 22.04 LTS or Debian 12
- Root or sudo access to the VPS
- Domain DNS already pointed to the VPS public IP

## Step 1: Initial server hardening

1. SSH into the VPS as root:
   ```bash
   ssh root@<VPS_IP>
   ```
2. Update the server:
   ```bash
   apt-get update && apt-get upgrade -y
   ```
3. Install base utilities:
   ```bash
   apt-get install -y curl ca-certificates gnupg lsb-release git htop vim
   ```
4. Harden SSH:
   ```bash
   sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
   sed -i 's/^#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
   sed -i 's/^#AllowUsers .*/AllowUsers erp/' /etc/ssh/sshd_config
   systemctl reload sshd
   ```
5. Create the deployment user and directories:
   ```bash
   groupadd --system erp
   useradd --system --gid erp --home /var/www/erp --shell /usr/sbin/nologin erp
   mkdir -p /var/www/erp /var/www/erp/logs /var/www/erp/backups
   chown -R erp:erp /var/www/erp
   ```

## Step 2: Firewall and access control

1. Install UFW:
   ```bash
   apt-get install -y ufw
   ```
2. Configure UFW:
   ```bash
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow OpenSSH
   ufw allow 'Nginx Full'
   ufw enable
   ufw status verbose
   ```

## Step 3: Install runtime dependencies

1. Install Node.js 20 and Nginx:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt-get install -y nodejs nginx
   ```
2. Install Certbot and PostgreSQL client:
   ```bash
   apt-get install -y certbot python3-certbot-nginx postgresql-client
   ```
3. Verify versions:
   ```bash
   node --version
   npm --version
   ```

## Step 4: Clone repository and configure environment

1. Clone into `/var/www/erp`:
   ```bash
   cd /var/www/erp
   sudo -u erp git clone https://github.com/3bud-ZC/ERP.git .
   ```
2. Copy the production env template:
   ```bash
   sudo -u erp cp deployment/.env.production.example .env
   ```
3. Populate environment variables in `/var/www/erp/.env`:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL=https://your-domain.com`
   - `NEXT_PUBLIC_API_URL=https://your-domain.com/api`
   - `ALLOW_SEED=false`
   - `E2E_BYPASS_RATE_LIMIT=0`
   - `E2E_ALLOW_AUTH_RESET=0`
   - `E2E_ALLOW_PRODUCTION_DB=0`
4. Secure `.env`:
   ```bash
   chmod 640 /var/www/erp/.env
   chown erp:erp /var/www/erp/.env
   ```

## Step 5: Build the application

1. Install app dependencies:
   ```bash
   cd /var/www/erp
   sudo -u erp npm ci
   ```
2. Generate Prisma client:
   ```bash
   sudo -u erp npx prisma generate
   ```
3. Apply migrations safely:
   ```bash
   sudo -u erp npx prisma migrate deploy
   ```
4. Build the Next.js app:
   ```bash
   sudo -u erp npm run build
   ```
5. Verify build output:
   ```bash
   ls -la /var/www/erp/.next/standalone/server.js
   ```

## Step 6: Configure process management

### Option A: systemd (recommended)
1. Copy service unit:
   ```bash
   cp /var/www/erp/deployment/erp-system.service /etc/systemd/system/
   ```
2. Reload systemd and enable service:
   ```bash
   systemctl daemon-reload
   systemctl enable --now erp-system
   ```
3. Verify service:
   ```bash
   systemctl status erp-system
   journalctl -u erp-system -f
   ```

### Option B: PM2 (optional)
1. Install PM2 globally:
   ```bash
   npm install -g pm2
   ```
2. Start the app with PM2:
   ```bash
   cd /var/www/erp
   pm2 start deployment/ecosystem.config.js --env production
   pm2 save
   ```
3. Verify:
   ```bash
   pm2 status
   pm2 logs erp-system -f
   ```

## Step 7: Configure Nginx and SSL

1. Copy the VPS Nginx config:
   ```bash
   cp /var/www/erp/deployment/nginx.conf /etc/nginx/nginx.conf
   ```
2. Edit `/etc/nginx/nginx.conf` and set:
   - `server_name your-domain.com`
   - correct `ssl_certificate` and `ssl_certificate_key` paths
3. Test config:
   ```bash
   nginx -t
   ```
4. Reload Nginx:
   ```bash
   systemctl reload nginx
   ```
5. Obtain an SSL certificate:
   ```bash
   certbot certonly --nginx -d your-domain.com
   ```
6. Reload Nginx again:
   ```bash
   systemctl reload nginx
   ```

## Step 8: Pre-launch verification

1. Confirm HTTP and HTTPS access:
   ```bash
   curl -I http://your-domain.com
   curl -I https://your-domain.com/api/health
   ```
2. Confirm local app is listening on `127.0.0.1:3000`:
   ```bash
   ss -tuln | grep 3000
   ```
3. Validate database connectivity:
   ```bash
   psql "$DATABASE_URL" -c 'SELECT 1'
   ```
4. Confirm disk space:
   ```bash
   df -h
   ```
5. Confirm RAM and swap:
   ```bash
   free -h
   ```

## Step 9: Log and backup setup

1. Review `deployment/LOGROTATE_RECOMMENDATIONS.md`.
2. Install and configure PM2 logrotate if using PM2.
3. Schedule backups and cleanup for `/var/www/erp/backups`.

## Step 10: Final launch readiness

1. Review `deployment/PRE_DEPLOYMENT_CHECKLIST.md`.
2. Review `deployment/FINAL_DEPLOYMENT_FLOW.md`.
3. Confirm all required ports and DNS/SSL readiness.
4. Confirm backups are valid.

## Post-deployment verification

1. Check `systemctl status erp-system` or `pm2 status`.
2. Check external health endpoint repeatedly for at least 5 minutes.
3. Monitor logs for errors:
   ```bash
   journalctl -u erp-system -f
   tail -f /var/www/erp/logs/pm2-error.log /var/www/erp/logs/pm2-out.log
   ```

# VPS Deployment Checklist

## 1. Server preparation
- [ ] Provision Ubuntu 22.04 / Debian 12 VPS
- [ ] Configure SSH access with keys only
- [ ] Disable password authentication and root login
- [ ] Install `curl`, `git`, `nginx`, `ufw`, `certbot`, `nodejs`, and `postgresql` if needed
- [ ] Enable `ufw` and allow ports 22, 80, 443

## 2. Application setup
- [ ] Create `erp` system user with home `/var/www/erp`
- [ ] Clone repo into `/var/www/erp`
- [ ] Copy `deployment/.env.production.example` to `/var/www/erp/.env`
- [ ] Fill in `DATABASE_URL`, `JWT_SECRET`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET`
- [ ] Set `.env` permissions to `640` and owner to `erp:erp`
- [ ] Install dependencies: `npm ci`
- [ ] Generate Prisma client: `npx prisma generate`
- [ ] Run migrations: `npx prisma migrate deploy`
- [ ] Build app: `npm run build`

## 3. Process manager
- [ ] Choose `systemd` or `PM2`
- [ ] For systemd: copy `deployment/erp-system.service` to `/etc/systemd/system/`
- [ ] Reload systemd: `systemctl daemon-reload`
- [ ] Enable and start service: `systemctl enable --now erp-system`
- [ ] Verify startup: `systemctl status erp-system`
- [ ] For PM2: `pm2 start deployment/ecosystem.config.js --env production`
- [ ] Save PM2 process list: `pm2 save`

## 4. Reverse proxy and SSL
- [ ] Copy `deployment/nginx.conf` to `/etc/nginx/nginx.conf`
- [ ] Update `server_name` with your domain
- [ ] Update SSL certificate paths if needed
- [ ] Test Nginx config: `nginx -t`
- [ ] Reload Nginx: `systemctl reload nginx`
- [ ] Obtain cert: `certbot certonly --nginx -d your-domain.com`
- [ ] Confirm HTTPS response: `curl -I https://your-domain.com`

## 5. Security and hardening
- [ ] Ensure PostgreSQL port 5432 is not publicly exposed
- [ ] Confirm app only listens on localhost:3000
- [ ] Confirm firewall only allows 22, 80, 443
- [ ] Install and enable `fail2ban`
- [ ] Disable SSH password auth and root SSH login
- [ ] Restrict SSH access to required users only
- [ ] Set `ALLOW_SEED=false` and `E2E_*` flags to `0`

## 6. Monitoring and recovery
- [ ] Verify `/api/health` returns `READY`
- [ ] Configure external monitoring (Uptime Robot / Healthchecks.io)
- [ ] Set up daily backups to `/var/www/erp/backups`
- [ ] Add cron job for `npm run backup` if desired
- [ ] Keep at least 30 days of backup retention

## 7. Rollback readiness
- [ ] Confirm Git rollback process works: `git revert` or `git reset --hard`
- [ ] Confirm old backup restore procedure
- [ ] Document current release commit hash
- [ ] Keep migration rollback policy in place: do not edit existing migrations

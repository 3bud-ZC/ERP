# Pre-Deployment Checklist

This checklist must be completed before the first production deployment on Ubuntu VPS.

## SSH security
- [ ] Confirm SSH access is key-based only
- [ ] Disable `PasswordAuthentication` in `/etc/ssh/sshd_config`
- [ ] Disable `PermitRootLogin` in `/etc/ssh/sshd_config`
- [ ] Restrict SSH access to specific users using `AllowUsers`
- [ ] Reload SSH: `sudo systemctl reload sshd`

## Firewall
- [ ] Install and enable UFW
- [ ] Set default policies: `ufw default deny incoming`, `ufw default allow outgoing`
- [ ] Allow `OpenSSH`, `Nginx Full`, and any required management ports
- [ ] Confirm UFW status: `ufw status verbose`

## Required ports
- [ ] Public ports: `80`, `443`
- [ ] Local-only ports: `3000` (app) and `5432` (PostgreSQL)
- [ ] Confirm no public access to `3000` or `5432`

## Domain readiness
- [ ] Domain DNS points to the VPS public IP
- [ ] `A` record exists for the domain
- [ ] Domain resolves correctly from the deployment host

## SSL readiness
- [ ] Install Certbot and Nginx plugin
- [ ] Ensure port `80` is reachable for HTTP-01 validation
- [ ] Run `certbot certonly --nginx -d your-domain.com` successfully
- [ ] Confirm cert files exist under `/etc/letsencrypt/live/your-domain.com/`

## Environment variables
- [ ] Create `/var/www/erp/.env` from `deployment/.env.production.example`
- [ ] Set `NODE_ENV=production`
- [ ] Set `PORT=3000`
- [ ] Set `DATABASE_URL` correctly
- [ ] Set `JWT_SECRET` with 32+ characters
- [ ] Set `NEXTAUTH_SECRET` with 32+ characters
- [ ] Set `NEXTAUTH_URL=https://your-domain.com`
- [ ] Set `NEXT_PUBLIC_API_URL` if client-side API URLs require it
- [ ] Set security flags:
  - `ALLOW_SEED=false`
  - `E2E_BYPASS_RATE_LIMIT=0`
  - `E2E_ALLOW_AUTH_RESET=0`
  - `E2E_ALLOW_PRODUCTION_DB=0`

## Prisma migration safety
- [ ] Confirm migration files are committed to Git
- [ ] Use `npx prisma migrate deploy` only in production
- [ ] Do NOT use `prisma db push` in production
- [ ] Confirm the production DB user has migration permissions

## Backup verification
- [ ] Confirm `pg_dump` or PostgreSQL client is installed
- [ ] Run `npm run backup` and verify a non-empty backup file is created
- [ ] Confirm backup path exists and is writable
- [ ] Confirm backup rotation policy will be configured before go-live

## Docker verification
- [ ] Confirm `docker-compose.prod.yml` uses `deployment/nginx.docker.conf`
- [ ] Confirm `app` port is bound to `127.0.0.1:3000:3000`
- [ ] Confirm certificate path mounting is defined correctly
- [ ] Confirm `Dockerfile.prod` builds and starts the standalone output

## PM2 verification
- [ ] Confirm PM2 is installed globally if using PM2
- [ ] Confirm `deployment/ecosystem.config.js` uses `PORT=3000`
- [ ] Confirm logs are written to `/var/www/erp/logs/pm2-out.log` and `pm2-error.log`
- [ ] Plan PM2 log rotation with `pm2-logrotate`

## systemd verification
- [ ] Confirm `deployment/erp-system.service` is copied to `/etc/systemd/system/`
- [ ] Confirm `EnvironmentFile=/var/www/erp/.env` is valid
- [ ] Confirm `ExecStart=/usr/bin/env npm run start:prod`
- [ ] Confirm `systemctl daemon-reload` and `systemctl enable --now erp-system` execute without errors

## Disk space checks
- [ ] Confirm the VPS has at least 20 GB available
- [ ] Confirm enough space for `node_modules`, `.next`, logs, backups
- [ ] Confirm disk usage with `df -h`

## RAM checks
- [ ] Confirm VPS has at least 2 GB RAM available
- [ ] Confirm swap is configured if RAM is limited
- [ ] Check current usage with `free -h`

## Node.js version checks
- [ ] Confirm `node --version` is `>= 18.0.0`
- [ ] Confirm `npm --version` is `>= 8.0.0`

## PostgreSQL checks
- [ ] Confirm PostgreSQL is installed if using local DB
- [ ] Confirm `psql` can connect to the DB
- [ ] Confirm database exists and user has permissions
- [ ] Confirm `DATABASE_URL` is valid and reachable

## Final readiness
- [ ] Confirm `deployment/FINAL_DEPLOYMENT_FLOW.md` has been reviewed
- [ ] Confirm `deployment/LOGROTATE_RECOMMENDATIONS.md` has been reviewed
- [ ] Confirm all steps are ready before executing production deployment

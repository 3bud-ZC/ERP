# VPS Deployment Assets

This folder contains production-ready deployment assets for Linux VPS hosting.

## Included files

- `nginx.conf` — VPS Nginx reverse proxy config with HTTPS redirect and security headers.
- `nginx.docker.conf` — Docker Compose Nginx config for containerized deployments.
- `ecosystem.config.js` — PM2 process manager configuration.
- `erp-system.service` — `systemd` service file for auto-start and restart.
- `scripts/install.sh` — install and bootstrap script for Ubuntu/Debian.
- `scripts/update.sh` — pull, build, migrate, and restart helper.
- `scripts/restart.sh` — restart the service using PM2 or systemd.
- `scripts/backup.sh` — run the app backup script in production.
- `.env.production.example` — production environment sample.
- `.env.development.example` — development environment sample.

## Usage

1. Copy the application source into `/var/www/erp` on the VPS.
2. Create `/var/www/erp/.env` from `.env.production.example`.
3. Install dependencies and build the app with `npm ci && npx prisma generate && npm run build`.
4. Choose either PM2 or systemd:
   - PM2: `pm2 start deployment/ecosystem.config.js --env production`
   - systemd: `sudo cp deployment/erp-system.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now erp-system`
5. Configure Nginx: copy `deployment/nginx.conf` to `/etc/nginx/nginx.conf` and update `server_name` and SSL certificate paths.
6. Enable firewall:
   - `ufw allow OpenSSH`
   - `ufw allow 'Nginx Full'`
   - `ufw enable`

## GitHub Deploy Flow

- GitHub Actions deploys automatically on pushes to `final`, `main`, or `master`.
- Each deploy uploads the current GitHub commit to the VPS, builds it there, runs Prisma migrations, and restarts the app.
- The active release is promoted through `/var/www/erp/current` so the service always boots from the latest validated build.

## Notes

- `nginx.conf` is VPS-focused and expects certificates under `/etc/letsencrypt/live/your-domain/`.
- `nginx.docker.conf` is the Docker Compose config used by `docker-compose.prod.yml`.
- `docker-compose.prod.yml` now uses `deployment/nginx.docker.conf` and mounts certificates into `/etc/letsencrypt/live`.
- `app` in Docker Compose is bound to `127.0.0.1:3000` only, preventing external access to the Next.js port.
- `npm run backup` now exists and runs `scripts/backup.ts`.
- `start:prod` and `start:orchestrated` now enforce startup validation via `scripts/system-start.js` instead of falling back silently to `next start`.
- `deployment/ecosystem.config.js` and `deployment/erp-system.service` both boot from `/var/www/erp/current` using `npm run start:prod`.
- SSH hardening is recommended: key-based SSH, disable password login, and restrict root access.
- For pre-deployment validation, review `deployment/PRE_DEPLOYMENT_CHECKLIST.md`.
- For log policy and PM2 retention guidance, review `deployment/LOGROTATE_RECOMMENDATIONS.md`.
- For exact Ubuntu VPS deployment execution, review `deployment/UBUNTU_VPS_EXECUTION_PLAN.md`.
- See `deployment/FINAL_DEPLOYMENT_FLOW.md` for the final production deployment order, rollback workflow, monitoring workflow, and hardening recommendations.
- Do not commit real secrets; use environment variables.

## Quick VPS Deployment Checklist

- [ ] Clone code into `/var/www/erp`
- [ ] Create `/var/www/erp/.env` from `.env.production.example`
- [ ] Install dependencies: `npm ci`
- [ ] Generate Prisma client: `npx prisma generate`
- [ ] Run migrations: `npx prisma migrate deploy`
- [ ] Build app: `npm run build`
- [ ] Install `erp-system.service` or start via PM2
- [ ] Copy `deployment/nginx.conf` to `/etc/nginx/nginx.conf`
- [ ] Configure SSL certificate paths and domain name
- [ ] Reload Nginx: `nginx -t && systemctl reload nginx`
- [ ] Validate health endpoint: `curl -I https://your-domain.com/api/health`

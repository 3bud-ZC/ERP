# Final Deployment Flow

## 1. Production Readiness Audit Summary

### Key Findings
- `package.json` production startup scripts were corrected so `start:prod` and `start:orchestrated` now enforce `scripts/system-start.js` without silently falling back to `next start`.
- Docker Compose port exposure is constrained: `app` is bound to `127.0.0.1:3000`, and only Nginx exposes public ports 80/443.
- `systemd` and `PM2` both use `npm run start:prod`, providing a consistent VPS runtime path.
- Docker deployment path intentionally differs: `Dockerfile.prod` starts the standalone build directly with `node server.js`, while VPS starts via `scripts/system-start.js`.
- Current backup logic only covers PostgreSQL; local uploaded assets are not included.
- There is no logrotate config in the repository yet; this is required for disk safety.
- `nginx.conf` and `middleware.ts` both set strong security headers; this is duplicate but acceptable as long as values remain aligned.
- `docker-compose.prod.yml` should be augmented with host certificate mounting instructions and may require `NEXT_PUBLIC_API_URL` if the client expects it.

### Security Conclusions
- Good: non-root service user for systemd (`erp`) and Docker image non-root user (`nextjs`).
- Good: firewall guidance restricts public access to ports 22, 80, 443 only.
- Good: Nginx config enforces modern TLS and security headers.
- Improvement: SSH hardening is documented and should be applied before production.
- Improvement: `docker-compose.prod.yml` uses the host `./ssl` mount; certificate management must be explicit.

### Deployment Consistency
- `docker-compose.prod.yml` is consistent with Docker runtime expectations.
- `deployment/nginx.conf` is consistent for bare-metal VPS.
- `deployment/nginx.docker.conf` is the correct Docker proxy config.
- `ecosystem.config.js` and `erp-system.service` are aligned on `PORT=3000`.
- `deployment/scripts/update.sh` and `deployment/scripts/restart.sh` handle both PM2 and systemd.

### Runtime Resilience
- systemd service restarts on failure with `Restart=on-failure`.
- PM2 is configured with `autorestart: true` and `max_restarts: 10`.
- Docker Compose uses `restart: unless-stopped`.
- Warning: single-instance systemd/PM2 setup is not true zero-downtime; restart will cause a brief outage.

### Resource Usage Risks
- Expected Node.js app RAM: ~250-400 MB for a Next.js production process with charts and runtime logic.
- PostgreSQL local service can use 200-500 MB depending on workload and cache settings.
- Recommended minimum VPS size: 2 GB RAM, 1 vCPU, 20 GB disk.
- Disk risk areas: `node_modules`, `.next`, backups, and log files.

### Prisma / Database Safety
- `deployment/scripts/update.sh` runs `npx prisma migrate deploy`, which is correct for production.
- Do not run `prisma db push` in production; it can be destructive.
- Do not use `npx prisma migrate dev` in production.
- Backup script uses `pg_dump`; it covers database data but not local uploaded files.

### Log & Disk Safety
- Add log rotation for:
  - `/var/www/erp/logs/*.log`
  - `/var/log/nginx/*.log`
  - `/var/log/syslog` if using local systemd logs
- Add backup retention policy, e.g. keep 30 days and prune older files.

### Healthcheck Reliability
- The app exposes `/api/health` and `/api/health/detailed`.
- External monitoring should target `/api/health` with `curl -f` or similar to detect failures.
- Verify Nginx proxying does not interfere with health responses.

### Monitoring Recommendations
- Use systemd journal monitoring for VPS (`journalctl -u erp-system -f`).
- Use Nginx access/error logs for request-level issues.
- Use external uptime monitoring (Uptime Robot, Healthchecks.io).
- Optionally add Prometheus/Grafana if advanced metrics are required.

## 2. Exact Production Architecture

### Folder structure on VPS

```
/var/www/erp/
├── .env
├── .env.production.example
├── app/
├── components/
├── deployment/
│   ├── nginx.conf
│   ├── nginx.docker.conf
│   ├── ecosystem.config.js
│   ├── erp-system.service
│   ├── scripts/
│   │   ├── install.sh
│   │   ├── update.sh
│   │   ├── restart.sh
│   │   └── backup.sh
│   ├── .env.development.example
│   └── FINAL_DEPLOYMENT_FLOW.md
├── logs/
│   ├── pm2-out.log
│   ├── pm2-error.log
│   └── ...
├── backups/
├── node_modules/
├── package.json
├── prisma/
├── public/
└── .next/
    ├── standalone/
    └── static/
```

### Runtime network flow

```
Internet -> Nginx (80/443) -> Next.js app (127.0.0.1:3000) -> PostgreSQL (localhost:5432)
```

## 3. Exact Deployment Order

### Step 1: Prepare server and secure SSH
1. Provision Ubuntu 22.04 / Debian 12.
2. Configure SSH keys only.
3. Disable `PermitRootLogin` and `PasswordAuthentication`.
4. Install `ufw`, allow ports 22, 80, 443.
5. Install `nginx`, `nodejs`, `npm`, `git`, `certbot`, `postgresql-client`.

### Step 2: Deploy code and configuration
1. Clone repository into `/var/www/erp`.
2. `chown -R erp:erp /var/www/erp`.
3. Copy `deployment/.env.production.example` to `/var/www/erp/.env`.
4. Fill required variables:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
   - `NEXT_PUBLIC_API_URL` if client-side API base URL is needed
5. Set permissions: `chmod 640 /var/www/erp/.env`.

### Step 3: Install dependencies and build
1. `cd /var/www/erp`
2. `npm ci`
3. `npx prisma generate`
4. `npx prisma migrate deploy`
5. `npm run build`

### Step 4: Configure process manager
- Use one of:
  - `systemd` (recommended)
  - `PM2` (optional)

#### Systemd startup
1. Copy `deployment/erp-system.service` to `/etc/systemd/system/`.
2. `systemctl daemon-reload`
3. `systemctl enable --now erp-system`
4. `systemctl status erp-system`

#### PM2 startup
1. `npm install -g pm2`
2. `pm2 start deployment/ecosystem.config.js --env production`
3. `pm2 save`
4. `pm2 status`

### Step 5: Configure Nginx and SSL
1. Copy `deployment/nginx.conf` to `/etc/nginx/nginx.conf`.
2. Set `server_name your-domain.com`.
3. Configure SSL cert paths.
4. `nginx -t`
5. `systemctl reload nginx`

### Step 6: Obtain certificates
1. `certbot certonly --nginx -d your-domain.com`
2. Confirm certs exist under `/etc/letsencrypt/live/your-domain.com/`.
3. `systemctl reload nginx`

### Step 7: Verify system
1. `curl -I https://your-domain.com/api/health`
2. `curl http://127.0.0.1:3000`
3. `systemctl status erp-system` or `pm2 logs erp-system`

## 4. Startup Sequence

### VPS startup sequence (systemd)
1. systemd loads `/var/www/erp/.env`.
2. `start:prod` executes `NODE_ENV=production node scripts/system-start.js`.
3. `system-start.js` runs startup validation and monitoring.
4. It spawns `node node_modules/.bin/next start`.
5. App listens on port 3000.
6. Nginx proxies traffic from 443 to `127.0.0.1:3000`.

### VPS startup sequence (PM2)
1. PM2 loads `deployment/ecosystem.config.js`.
2. It runs `npm run start:prod` in `/var/www/erp`.
3. App starts the same way as systemd.

### Docker Compose startup
1. Docker Compose builds with `Dockerfile.prod`.
2. `Dockerfile.prod` generates standalone output and copies it into runner image.
3. Container starts as non-root user `nextjs` with `node server.js`.
4. Nginx container proxies public ports 80/443 to `app:3000`.

> Note: Docker path intentionally bypasses `scripts/system-start.js`. This is acceptable for containerized deployment, but it means the orchestrator validation logic is not executed inside Docker.

## 5. Update Workflow

### Update on VPS with systemd/PM2
1. `cd /var/www/erp`
2. `git fetch --all --prune`
3. `git pull --ff-only`
4. `npm ci`
5. `npx prisma generate`
6. `npx prisma migrate deploy`
7. `npm run build`
8. If PM2: `pm2 reload ecosystem.config.js --env production`
9. If systemd: `systemctl restart erp-system`

### Notes
- `npx prisma migrate deploy` is the production-safe migration command.
- Avoid `prisma db push` and `npx prisma migrate dev` in production.
- For true zero-downtime, upgrade to a load-balanced multi-instance deployment or use a process manager with cluster mode.

## 6. Rollback Workflow

### Code rollback
1. `cd /var/www/erp`
2. `git log --oneline -5`
3. `git revert HEAD` or `git reset --hard <previous-commit>`
4. `npm run build`
5. Restart service:
   - `systemctl restart erp-system`
   - or `pm2 restart erp-system`

### Database rollback
- Prefer restoring from backup over rolling back a migration.
- If a migration must be resolved, use `npx prisma migrate resolve --rolled-back <MIGRATION_NAME>` only after careful review.

### Restore from backup
1. Stop service.
2. `sudo -u postgres psql erp_system < /var/www/erp/backups/backup-YYYY-MM-DD-*.sql`
3. Restart service.
4. Verify health endpoint.

## 7. Monitoring Workflow

### Local VPS monitoring
- `journalctl -u erp-system -f`
- `systemctl status erp-system`
- `pm2 logs erp-system -f` (if PM2)
- `htop` / `top`
- `df -h`
- `free -h`

### External monitoring
- Monitor `https://your-domain.com/api/health`
- Configure alerts for HTTP failure and high latency.
- Use a monitoring interval of 5 minutes.

## 8. Log Rotation & Disk Safety

### Recommended logrotate file `/etc/logrotate.d/erp-system`

```text
/var/www/erp/logs/*.log {
  daily
  rotate 14
  compress
  missingok
  notifempty
  copytruncate
  dateext
}

/var/log/nginx/*.log {
  daily
  rotate 14
  compress
  missingok
  notifempty
  sharedscripts
  postrotate
    [ -f /run/nginx.pid ] && kill -USR1 `cat /run/nginx.pid`
  endscript
}
```

### Recommended retention
- Keep 14 days for application logs.
- Keep 30 days for backups.
- Prune old backup files with `find /var/www/erp/backups -mtime +30 -delete`.

## 9. Backup Integrity

### Current backup coverage
- `npm run backup` runs `scripts/backup.ts`.
- It performs a `pg_dump` of the configured PostgreSQL database.

### Gaps to address
- Local uploaded assets or file storage are not included in `scripts/backup.ts`.
- If the app stores files locally, add a filesystem backup step for the upload directory.

### Verification
- Confirm backup file exists and is non-empty.
- Example:
  - `ls -lah /var/www/erp/backups/`
  - `file /var/www/erp/backups/backup-*.sql`
  - `gzip -t /var/www/erp/backups/backup-*.sql.gz` if compressed

## 10. Production Hardening Checklist

### No unnecessary public ports
- Expose only `80` and `443` publicly.
- Keep `3000` and `5432` bound to localhost only.

### Environment variable consistency
- Required production vars:
  - `NODE_ENV=production`
  - `PORT=3000`
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `NEXTAUTH_SECRET`
  - `NEXTAUTH_URL`
  - optionally `NEXT_PUBLIC_API_URL`
- Ensure `ALLOW_SEED=false`, `E2E_BYPASS_RATE_LIMIT=0`, `E2E_ALLOW_AUTH_RESET=0`, and `E2E_ALLOW_PRODUCTION_DB=0`.

### Prisma safety
- Use `npx prisma migrate deploy` in production.
- Avoid schema push or dev migrations.
- Keep migration files immutable.

### Zero-downtime note
- Current setup is not fully zero-downtime.
- For no service interruption, use a multi-instance deployment or a blue/green deployment strategy.

## 11. Final Recommendation

Use this document as the authoritative production deployment flow. Ensure the VPS deployment path is separate from Docker Compose, and keep the following rules:

- `deployment/nginx.conf` for bare-metal VPS.
- `deployment/nginx.docker.conf` for containerized deployments.
- `npm run start:prod` for VPS runtime.
- `docker-compose` uses `node server.js` inside `Dockerfile.prod`.

Once validated, run the full production checklist and then deploy in a controlled, staged manner.

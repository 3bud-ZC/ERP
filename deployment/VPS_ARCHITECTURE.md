# VPS Deployment Architecture & Design

## Target VPS Environment

- **OS:** Ubuntu 22.04 LTS or Debian 12
- **Node.js:** 20.x LTS
- **Database:** PostgreSQL 15 (local or managed remote)
- **Reverse Proxy:** Nginx
- **Process Manager:** PM2 or systemd
- **SSL:** Let's Encrypt (Certbot)
- **Firewall:** UFW (Uncomplicated Firewall)

## VPS Directory Structure

```
/var/www/erp/
├── .env                          # (DO NOT COMMIT) Production environment
├── .env.production.example       # Reference template
├── app/ node_modules/ prisma/    # Application code
├── .next/
│   ├── standalone/               # Next.js production build
│   └── static/
├── deployment/
│   ├── nginx.conf                # Nginx reverse proxy config
│   ├── ecosystem.config.js       # PM2 process manager config
│   ├── erp-system.service        # systemd service file
│   ├── scripts/
│   │   ├── install.sh
│   │   ├── update.sh
│   │   ├── restart.sh
│   │   └── backup.sh
│   ├── .env.production.example
│   └── README.md
├── logs/
│   ├── pm2-out.log               # PM2 stdout
│   ├── pm2-error.log             # PM2 stderr
│   ├── nginx-access.log          # (symlink to /var/log/nginx/access.log)
│   └── nginx-error.log           # (symlink to /var/log/nginx/error.log)
├── backups/
│   └── backup-2026-05-15-*.sql   # Automated database backups
└── package.json

/etc/
├── nginx/
│   ├── nginx.conf                # Main Nginx config (from deployment/nginx.conf)
│   └── ssl/
│       ├── your-domain.pem       # Let's Encrypt cert
│       └── your-domain-key.pem   # Private key
└── systemd/system/
    └── erp-system.service        # systemd service unit (if using systemd)

/var/log/
├── nginx/
│   ├── access.log
│   └── error.log
└── syslog                        # systemd journal logs for erp-system

/home/erp/                        # App service user home
└── .ssh/                         # SSH key for Git deployments (optional)
```

## Network Flow

```
Internet (HTTPS:443)
    ↓
Nginx (Reverse Proxy + SSL)  [Port 443, 80]
    ↓
Next.js App                   [Port 3000, localhost only]
    ↓
PostgreSQL                    [Port 5432, localhost only - NOT PUBLIC]
```

## Environment Variables Placement

### `.env` file location
- **Path:** `/var/www/erp/.env`
- **Permissions:** `640` (owner read/write, group read, others nothing)
- **Owner:** `erp:erp`
- **Template:** Use `deployment/.env.production.example` as reference
- **Sourced by:** systemd via `EnvironmentFile` or PM2 via `npm start` script

### Required variables (PRODUCTION)
```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://postgres:STRONG_PASSWORD@localhost:5432/erp_system
JWT_SECRET=<32+ random hex chars>
NEXTAUTH_SECRET=<32+ random hex chars>
NEXTAUTH_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://your-domain.com/api
```

### Security flags (PRODUCTION - all must be false/0)
```
ALLOW_SEED=false
E2E_BYPASS_RATE_LIMIT=0
E2E_ALLOW_AUTH_RESET=0
E2E_ALLOW_PRODUCTION_DB=0
NEXT_TELEMETRY_DISABLED=1
```

## Port Exposure

### Allowed (Public Internet)
- **Port 80** (HTTP) → Nginx, redirects to HTTPS
- **Port 443** (HTTPS) → Nginx, SSL termination

### Allowed (Localhost Only)
- **Port 3000** → Next.js app (Nginx proxies to this)
- **Port 5432** → PostgreSQL (local only, not exposed to network)

### NOT EXPOSED
- PostgreSQL port 5432 should NOT be open to the public
- PM2 web UI (if enabled) should NOT be exposed
- Prisma Studio port should NOT be accessible

## Database Connection Strategy

### Local PostgreSQL (Recommended for single VPS)
```
DATABASE_URL=postgresql://postgres:STRONG_PASSWORD@localhost:5432/erp_system
```
- Postgres installed on same VPS
- Data persisted in `/var/lib/postgresql/data`
- Backup via `pg_dump` script

### Remote Managed PostgreSQL (e.g., AWS RDS, Railway, Neon)
```
DATABASE_URL=postgresql://user:password@db-instance.region.provider.com:5432/erp_system
```
- Provider manages backups and failover
- Encryption in transit required (enforce SSL)
- Firewall must allow VPS IP to connect

## SSL/TLS Strategy

### Let's Encrypt + Certbot (Recommended)
- **Auto-renewal:** Certbot renews 30 days before expiry
- **Certificate path:** `/etc/letsencrypt/live/your-domain/fullchain.pem`
- **Private key path:** `/etc/letsencrypt/live/your-domain/privkey.pem`
- **Nginx config:** `deployment/nginx.conf` expects these paths
- **Renewal validation:** HTTP-01 (Nginx handles this automatically)

### Manual certificate placement
```bash
# If not using Certbot, place certificates here:
/etc/letsencrypt/live/your-domain/fullchain.pem
/etc/letsencrypt/live/your-domain/privkey.pem
```

## Prisma Database Migrations

### Migration Flow (Production-Safe)
1. **Develop locally** → Create migration (`prisma migrate dev`)
2. **Commit to Git** → Push to repository
3. **Deploy to VPS:**
   - Pull latest code
   - Run `npx prisma migrate deploy` (idempotent, forward-only)
   - No downtime if migrations are additive
   - **IMPORTANT:** Never run `prisma db push` in production (destructive)

### Rollback Strategy
- Migrations are immutable in production
- If a migration causes issues:
  1. Roll back app code to previous version
  2. Create a new migration to fix the schema
  3. Deploy the fix
- **Never** delete or modify existing migration files

## Data Backup Strategy

### Automated backups
- **Script:** `npm run backup` (runs `scripts/backup.ts`)
- **Frequency:** Manual or via cron job (recommended daily)
- **Storage:** `/var/www/erp/backups/` (should be on separate volume)
- **Retention:** Keep 30 days of backups
- **Test restores:** Monthly verification

### Backup cron job example
```bash
0 2 * * * cd /var/www/erp && npm run backup >> /var/log/erp-backup.log 2>&1
```

## Zero-Downtime Updates

### Strategy
1. **Pull latest code** on existing instance
2. **Run Prisma migrations** (`npx prisma migrate deploy`)
3. **Build new app** (`npm run build`)
4. **Restart process** (PM2 `reload` or systemd `restart`)
   - PM2: Gracefully stops old processes, starts new ones
   - systemd: Brief pause (< 5 seconds typical)

### Minimal downtime approach
- Update static assets first (no restart needed)
- Update code (requires restart)
- Migrations (must be before app restart)

## Monitoring & Health Checks

### Application health endpoint
- **GET /api/health** → Simple liveness probe
- **GET /api/health/detailed** → Full readiness probe
- Expected response: `{ "success": true, "status": "READY" }`

### Nginx health location
```nginx
location /nginx-health {
  access_log off;
  return 200 "ok";
}
```

### External monitoring
- Use a service like Uptime Robot or Healthchecks.io
- Check `/api/health` every 5-10 minutes
- Alert on failure (email, Slack, PagerDuty)

## Security Hardening (Post-Deployment)

### SSH hardening
- Disable password auth (SSH keys only)
- Disable root login via SSH: `PermitRootLogin no`
- Restrict users allowed to connect: `AllowUsers erp adminuser`
- Change SSH port from 22 (optional but recommended)
- Use `fail2ban` to auto-ban repeated failed login attempts

### Firewall rules (UFW)
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw enable
```

### System updates
```bash
apt-get update && apt-get upgrade -y
apt-get install -y unattended-upgrades fail2ban
```

## Process Manager Selection

### PM2 (Recommended for simplicity)
- Pros: Simple, cluster mode, process monitoring, ecosystem config
- Cons: Requires npm/Node to be available globally
- Use when: Single app instance on VPS

### systemd (Recommended for production)
- Pros: OS-native, secure, minimal overhead, standard across Linux
- Cons: Less user-friendly, requires configuration
- Use when: Long-term stability, minimal resource overhead

**Recommendation:** Use systemd for production (more secure, OS-native), use PM2 for development/staging.

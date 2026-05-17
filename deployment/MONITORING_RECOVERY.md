# Monitoring, Health Checks & Disaster Recovery

## Application Health Endpoints

### `/api/health` — Liveness Probe (Quick Check)
```bash
curl https://your-domain.com/api/health

# Expected response (HTTP 200):
{
  "success": true,
  "status": "READY",
  "timestamp": "2026-05-15T10:30:45Z"
}
```

**Use case:** Quick liveness check (is the app responding?)  
**Interval:** Every 30-60 seconds  
**Timeout:** 5 seconds  
**Alert if:** No response or status ≠ "READY"

### `/api/health/detailed` — Readiness Probe (Full Diagnostics)
```bash
curl https://your-domain.com/api/health/detailed

# Expected response (HTTP 200):
{
  "success": true,
  "status": "READY",
  "checks": {
    "database": "OK",
    "cache": "OK",
    "filesystem": "OK"
  },
  "timestamp": "2026-05-15T10:30:45Z"
}
```

**Use case:** Full readiness check (can the app handle requests?)  
**Interval:** Every 5 minutes  
**Timeout:** 10 seconds  
**Alert if:** Any check fails or status ≠ "READY"

---

## Setting Up External Monitoring

### Option 1: Uptime Robot (Free tier available)

1. Sign up at https://uptimerobot.com
2. Create new monitor:
   - **Type:** HTTPS
   - **URL:** `https://your-domain.com/api/health`
   - **Interval:** 5 minutes
   - **Timeout:** 30 seconds
3. Add alert contacts (email, Slack, webhook)
4. Enable notifications

### Option 2: Healthchecks.io (Free tier available)

1. Sign up at https://healthchecks.io
2. Create a check:
   - **Name:** ERP System
   - **Type:** HTTP
   - **URL:** `https://your-domain.com/api/health`
3. Configure grace period (5 minutes)
4. Add alerting channels

### Option 3: Grafana Cloud (Advanced)

1. Set up Prometheus scrape job in `/etc/prometheus/prometheus.yml`:
```yaml
scrape_configs:
  - job_name: 'erp-system'
    static_configs:
      - targets: ['your-domain.com:443']
    metrics_path: '/api/health/detailed'
    scheme: 'https'
```

2. Create dashboard with health status widget

---

## Local Monitoring (VPS Native)

### Monitor process status (systemd)
```bash
# Watch service status continuously
watch -n 5 'systemctl status erp-system'

# Get detailed status with logs
journalctl -u erp-system --since "1 hour ago"

# Alert on restart (if restarted recently, app may be crashing)
systemctl status erp-system | grep -i restart
```

### Monitor resource usage
```bash
# Real-time monitoring
htop
# App should use:
#   - CPU: 0-5% idle
#   - RAM: 100-300 MB
#   - If exceeding: check for memory leaks

# One-time snapshot
ps aux | grep "node\|npm" | grep -v grep
free -h                 # Memory usage
df -h                   # Disk usage
top -bn1 | head -20     # Top processes
```

### Monitor logs
```bash
# Follow systemd logs in real-time
journalctl -u erp-system -f

# Or for PM2:
pm2 logs erp-system -f

# Search for errors in past hour
journalctl -u erp-system --since "1 hour ago" | grep -i error
```

### Monitor database connections
```bash
# Check if PostgreSQL is overloaded
sudo -u postgres psql -c "SELECT count(*) FROM pg_stat_activity;"
# Should be < 10 connections normally

# Check for long-running queries
sudo -u postgres psql -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';"
```

---

## Alerting Strategy

### Recommended alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| **App down** | `/api/health` returns 5xx or timeout | Restart systemd service, page on-call |
| **Database down** | `/api/health/detailed` shows DB check fail | Check PostgreSQL, restart if needed |
| **High memory** | Process > 500 MB RAM | Restart app, investigate memory leak |
| **High CPU** | Process > 80% CPU sustained | Check slow queries, profile app |
| **Disk full** | `/var/www/erp` > 90% | Clean logs, rotate backups |
| **SSL cert expiring** | < 14 days to expiry | Manual certbot renew (Certbot auto-renews) |

### Alert notification channels

**Email**
- Simple, works everywhere
- Recommended for critical alerts

**Slack**
```
1. Create incoming webhook in Slack
2. POST JSON to webhook URL when alert triggers
3. Message lands in #alerts channel
```

**PagerDuty**
- For on-call rotation
- Escalates if not acknowledged

**Webhook**
- Custom integration (Telegram, Discord, etc.)
- POST JSON with alert details

---

## Rollback Procedures

### Scenario 1: New deployment broke the app

#### Quick rollback (1-2 minutes)
```bash
# Revert to previous Git commit
cd /var/www/erp
git log --oneline -5
git revert HEAD            # Or git reset --hard HEAD~1 (use with caution)

# Rebuild and restart
npm run build
systemctl restart erp-system

# Verify
curl https://your-domain.com/api/health
```

#### If database migration is the problem
```bash
# Rollback migrations (if possible)
# WARNING: This is destructive and should be tested before production

npx prisma migrate resolve --rolled-back <MIGRATION_NAME>
# Then deploy a new migration to fix the issue
```

### Scenario 2: Database is corrupted

#### Restore from backup
```bash
# List available backups
ls -lah /var/www/erp/backups/

# Stop the app
systemctl stop erp-system

# Restore database from backup
BACKUP_FILE="/var/www/erp/backups/backup-2026-05-14-*.sql"
sudo -u postgres psql erp_system < $BACKUP_FILE

# Restart app
systemctl start erp-system

# Verify
curl https://your-domain.com/api/health
```

### Scenario 3: SSL certificate expired

#### Emergency renewal
```bash
# Even if auto-renewal failed
certbot renew --force-renewal

# Reload Nginx
systemctl reload nginx

# Verify
curl -I https://your-domain.com
```

### Scenario 4: Nginx is broken

#### Fallback to direct app connection
```bash
# If Nginx config is broken:
# 1. Stop Nginx temporarily
systemctl stop nginx

# 2. Access app directly (for emergency access only)
curl http://your-vps-ip:3000

# 3. Fix Nginx config
nano /etc/nginx/nginx.conf
nginx -t   # Verify syntax

# 4. Restart Nginx
systemctl restart nginx
```

### Scenario 5: Complete VPS failure (upgrade, security patch, etc.)

#### Pre-planned maintenance window
```bash
# 1. Take backup (extra safety)
npm run backup

# 2. Stop app gracefully
systemctl stop erp-system

# 3. Perform maintenance (e.g., OS security update)
apt-get update && apt-get upgrade -y
reboot

# 4. After VPS comes back up, verify services
systemctl status erp-system    # Should be running (auto-started)
systemctl status nginx         # Should be running
curl https://your-domain.com/api/health
```

---

## Disaster Recovery Plan

### Critical Data Locations
```
/var/www/erp/.env                # Application secrets
/var/www/erp/backups/            # Database backups
/var/lib/postgresql/data         # PostgreSQL data (if local)
/etc/letsencrypt/                # SSL certificates
/etc/nginx/nginx.conf            # Nginx configuration
/etc/systemd/system/erp-system.service  # systemd service
```

### Backup Strategy
1. **Daily automated backups** at 2 AM (via cron)
2. **Weekly manual backup** of config files
3. **Monthly restoration test** (verify backups are valid)
4. **Keep 30 days** of daily backups

### Recovery Time Objectives (RTO)
| Scenario | RTO | Notes |
|----------|-----|-------|
| App crash | 30 sec | Automatic systemd restart |
| Database connection loss | 2 min | Restart PostgreSQL or check network |
| SSL certificate expires | 5 min | Certbot auto-renewal or manual |
| Disk full | 10 min | Delete old logs, clean backups |
| Complete VPS failure | 1 hour | Restore from backup, rebuild |
| Corrupted database | 30 min | Restore from backup, verify data |

### Data Recovery Procedure
```bash
# 1. Identify problem
curl https://your-domain.com/api/health
# If error: check logs for details

# 2. Stop affected service
systemctl stop erp-system

# 3. Take fresh backup (before making changes)
npm run backup

# 4. Restore from known-good backup
BACKUP="/var/www/erp/backups/backup-YYYY-MM-DD-TIME.sql"
sudo -u postgres psql erp_system < $BACKUP

# 5. Verify data integrity
npx prisma db execute --stdin < /dev/null  # Test connection

# 6. Restart services
systemctl start erp-system

# 7. Verify
curl https://your-domain.com/api/health
```

---

## Maintenance Checklist

### Daily
- [ ] Monitor `/api/health` endpoint (external service or manual check)
- [ ] Check systemd logs for errors: `journalctl -u erp-system --since "1 day ago" | grep -i error`

### Weekly
- [ ] Backup config files: `tar -czf config-backup-$(date +%Y%m%d).tar.gz /etc/nginx /etc/systemd`
- [ ] Test database backup restoration in staging (if possible)
- [ ] Review disk usage: `df -h`

### Monthly
- [ ] Full system update test: `apt-get update && apt-get upgrade -y` (in staging first)
- [ ] SSL certificate check: `certbot certificates`
- [ ] Database integrity check: `sudo -u postgres vacuumdb -z erp_system`
- [ ] Review access logs for suspicious activity: `tail -100 /var/log/nginx/access.log`

### Quarterly
- [ ] Security audit: review UFW rules, SSH config, user accounts
- [ ] Disaster recovery drill: restore from backup to staging environment
- [ ] Performance profiling: check for slow API endpoints

---

## Emergency Contacts & Documentation

Create a runbook at `/var/www/erp/docs/RUNBOOK.md`:

```markdown
# ERP System Emergency Runbook

## Critical Contacts
- On-call engineer: [NAME, PHONE, EMAIL]
- Database admin: [NAME, EMAIL]
- Domain registrar: [COMPANY, ACCOUNT]

## Critical Credentials (Encrypted)
- VPS SSH key: [LOCATION]
- PostgreSQL admin password: [VAULT]
- Let's Encrypt account email: [EMAIL]
- Uptime monitoring password: [VAULT]

## Critical Paths
- App directory: /var/www/erp
- Config: /var/www/erp/.env
- Backups: /var/www/erp/backups/
- Nginx: /etc/nginx/nginx.conf
- Systemd: /etc/systemd/system/erp-system.service

## Quick Recovery Commands
[List common recovery commands here]
```

**Keep this document in a secure location (password manager, encrypted drive).**

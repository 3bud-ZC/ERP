# Production Troubleshooting Guide

## Common Issues & Solutions

### 1. App Not Starting

**Error:** `systemctl status erp-system` shows "failed" or "inactive"

**Diagnostics:**
```bash
# Check logs
journalctl -u erp-system -n 50 --no-pager
pm2 logs erp-system 2>&1 | tail -50

# Check if port 3000 is available
lsof -i :3000
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| `.env` file missing | Create `.env` from `.env.production.example` |
| `DATABASE_URL` not set | Edit `.env`, add correct connection string |
| `JWT_SECRET` too short | Regenerate with 32+ characters: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| Port 3000 in use | `kill -9 <PID>` for process using port |
| Out of memory | Increase VPS RAM or check for memory leak |
| Node version mismatch | Verify `node --version` is 18+ |

**Recovery:**
```bash
systemctl restart erp-system
journalctl -u erp-system -f
```

---

### 2. Database Connection Failed

**Error:** `PrismaClientInitializationError: Can't reach database server`

**Diagnostics:**
```bash
# Test connection manually
PGPASSWORD=yourpassword psql -h localhost -U postgres -d erp_system -c "SELECT 1;"

# Check PostgreSQL is running
systemctl status postgresql

# Check port 5432 accessibility
nc -zv localhost 5432

# Check database exists
PGPASSWORD=yourpassword psql -h localhost -U postgres -l | grep erp_system
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| PostgreSQL not running | `systemctl start postgresql` |
| Connection string wrong | Check `DATABASE_URL` in `.env` |
| Database doesn't exist | `sudo -u postgres createdb erp_system` |
| User lacks permissions | `sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'newpass';"` |
| Firewall blocking | `sudo ufw allow from localhost to any port 5432` |
| Remote DB unreachable | Check VPS can reach remote server: `curl -v postgres-host:5432` |

**Recovery:**
```bash
# Verify connection
DATABASE_URL="postgresql://postgres:password@localhost:5432/erp_system" \
  npx prisma db execute --stdin < /dev/null

# Run migrations
npx prisma migrate deploy

# Restart app
systemctl restart erp-system
```

---

### 3. Nginx 502 Bad Gateway

**Error:** Browser shows "502 Bad Gateway" when accessing https://domain.com

**Diagnostics:**
```bash
# Check app is running
curl http://localhost:3000

# Check Nginx logs
tail -50 /var/log/nginx/error.log

# Check Nginx config
nginx -t

# Check if Nginx can reach app
curl http://localhost:3000 -H "Host: your-domain.com"
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| App crashed | `systemctl restart erp-system` |
| App not listening | Check `systemctl status erp-system` |
| Nginx config wrong | Re-check `/etc/nginx/nginx.conf` upstream block |
| Firewall blocking 3000 | Should be localhost only (not needed for UFW) |
| Port conflict | Another process on 3000: `lsof -i :3000` |

**Recovery:**
```bash
# 1. Restart app
systemctl restart erp-system

# 2. Reload Nginx
systemctl reload nginx

# 3. Test
curl https://your-domain.com
```

---

### 4. SSL Certificate Issues

**Error 1:** Browser shows "NET::ERR_CERT_AUTHORITY_INVALID"

**Diagnostics:**
```bash
# Check certificate exists
ls -la /etc/letsencrypt/live/your-domain.com/

# Check Nginx config paths
grep "ssl_certificate" /etc/nginx/nginx.conf

# Verify certificate is valid
openssl x509 -enddate -noout -in /etc/letsencrypt/live/your-domain.com/cert.pem

# Test HTTPS connection
openssl s_client -connect your-domain.com:443 -tls1_3
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Certificate path wrong | Check paths in `/etc/nginx/nginx.conf` match actual files |
| Certificate expired | `certbot renew --force-renewal` |
| Domain name mismatch | Certificate must match domain in browser |
| Certificate not installed | Run `certbot certonly --nginx -d your-domain.com` |
| Nginx not reloaded | `systemctl reload nginx` after updating cert |

**Error 2:** Certificate renewal failed

**Diagnostics:**
```bash
# Check auto-renewal status
systemctl status certbot.timer

# Test renewal manually
certbot renew --dry-run -v

# Check renewal logs
journalctl -u certbot.service --since "1 day ago"
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Port 80 not reachable | Certbot needs HTTP for validation, check `ufw allow 80` |
| Wrong renewal hook | Check certbot post-renewal hook in `/etc/letsencrypt/renewal/` |
| Disk full | `df -h`, clean up backups if needed |
| DNS not pointing to VPS | Verify `nslookup your-domain.com` resolves to VPS IP |

**Recovery:**
```bash
# Force renewal and test
certbot renew --force-renewal

# Reload Nginx
systemctl reload nginx

# Verify
curl -I https://your-domain.com
```

---

### 5. High CPU/Memory Usage

**Error:** App using 100% CPU or > 500 MB memory

**Diagnostics:**
```bash
# Check process memory
ps aux | grep "node\|npm" | grep -v grep

# Monitor in real-time
top -p $(pgrep -f "node server.js")

# Check for slow database queries
sudo -u postgres psql erp_system -c "SELECT query, calls, total_time FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"

# Check connection pool exhaustion
sudo -u postgres psql erp_system -c "SELECT count(*) FROM pg_stat_activity;"
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Memory leak | Restart app: `systemctl restart erp-system` |
| Slow database query | Check query logs, add indexes if needed |
| Too many connections | Increase Prisma connection pool or restart |
| Inefficient code | Profile with Node.js profiler, file bug report |
| Stale processes | Kill zombie: `pkill -9 -f "node server.js"` |

**Recovery:**
```bash
# Graceful restart (doesn't drop connections)
systemctl restart erp-system

# Wait and check
sleep 5
ps aux | grep node | grep -v grep
```

---

### 6. Prisma Migration Failed

**Error:** `npx prisma migrate deploy` fails

**Diagnostics:**
```bash
# Check which migrations pending
npx prisma migrate status

# Inspect migration file
ls -la prisma/migrations/

# Test connection before migration
npx prisma db execute --stdin < /dev/null

# Check database schema
sudo -u postgres psql erp_system -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public';"
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Database not accessible | Test: `psql -h localhost erp_system` |
| Migration file corrupt | Restore from backup, retry |
| Schema drift | Check if schema matches migration expectations |
| Pending failed migration | `npx prisma migrate resolve --rolled-back <MIGRATION>` (risky) |

**Recovery:**
```bash
# 1. Identify failed migration
npx prisma migrate status

# 2. If safe to retry:
npx prisma migrate deploy

# 3. If must rollback (advanced):
# Create a new migration to fix the issue instead of rolling back
npx prisma migrate dev --name fix_failed_migration

# 4. Restart app after migration completes
systemctl restart erp-system
```

---

### 7. Disk Full

**Error:** "No space left on device" or app crashes with I/O errors

**Diagnostics:**
```bash
# Check disk usage
df -h

# Find large files/directories
du -sh /var/www/erp/* | sort -h
du -sh /var/log/* | sort -h
du -sh /var/lib/postgresql/data/* 2>/dev/null | sort -h
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Old logs filling disk | `rm /var/log/nginx/*.1 /var/log/nginx/*.2.gz` (keep current logs) |
| Backup files too many | `ls -lah /var/www/erp/backups/ | tail` then delete old ones |
| PostgreSQL bloat | `sudo -u postgres vacuumdb -z erp_system` |
| Nginx cache | `find /var/cache/nginx -type f -delete` |

**Recovery:**
```bash
# 1. Remove old logs (keep last 10 days)
find /var/log -mtime +10 -type f -delete

# 2. Clean backups (keep last 30 days)
find /var/www/erp/backups -mtime +30 -delete

# 3. Verify space is available
df -h

# 4. Restart app if it crashed
systemctl restart erp-system
```

---

### 8. UFW Firewall Blocks Traffic

**Error:** Can't access port 80 or 443 from internet

**Diagnostics:**
```bash
# Check UFW status
ufw status verbose

# Check if port is open
telnet your-domain.com 443
curl -I https://your-domain.com

# Check listening ports
netstat -tuln | grep LISTEN
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Port not allowed | `ufw allow 80/tcp && ufw allow 443/tcp` |
| UFW not enabled | `ufw enable` |
| VPS IP whitelist on provider | Check VPS control panel for port restrictions |

**Recovery:**
```bash
# Ensure ports are open
ufw allow 80/tcp
ufw allow 443/tcp
ufw reload

# Test
curl -I https://your-domain.com
```

---

### 9. Backup Script Fails

**Error:** `npm run backup` returns error or no backup file created

**Diagnostics:**
```bash
# Check if pg_dump is available
which pg_dump

# Test PostgreSQL connection for backup
PGPASSWORD=yourpass pg_dump -h localhost -U postgres erp_system > /tmp/test.sql
ls -la /tmp/test.sql

# Check backup directory permissions
ls -la /var/www/erp/backups/
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| `pg_dump` not installed | `apt-get install -y postgresql-client` |
| Directory not writable | `chmod 755 /var/www/erp/backups && chown erp:erp /var/www/erp/backups` |
| Database not accessible | Test connection: `psql -h localhost -U postgres erp_system` |
| Disk full | Free up space: see "Disk Full" section above |

**Recovery:**
```bash
# Test backup manually
sudo -u erp npm run backup

# Verify backup file created
ls -la /var/www/erp/backups/ | tail -1
```

---

### 10. Slow API Responses

**Error:** API takes > 5 seconds to respond

**Diagnostics:**
```bash
# Measure response time
time curl https://your-domain.com/api/health

# Check app logs for slow endpoints
journalctl -u erp-system | grep -i "duration\|slow\|ms"

# Check database query performance
sudo -u postgres psql erp_system -c "SELECT mean_time, calls, query FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 5;"

# Check resource usage during requests
top -bn1 | head -10
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Database query too slow | Add indexes: `CREATE INDEX idx_name ON table(column);` |
| N+1 query problem | Optimize Prisma queries with `.include()` or `.select()` |
| Network latency | Use `traceroute your-domain.com` to check path |
| High server load | Scale vertically (more VPS resources) or horizontally |

**Recovery:**
```bash
# Profile endpoint
curl -w "@-" -o /dev/null -s https://your-domain.com/api/dashboard <<'EOF'
    time_namelookup:  %{time_namelookup}\n
    time_connect:     %{time_connect}\n
    time_appconnect:  %{time_appconnect}\n
    time_pretransfer: %{time_pretransfer}\n
    time_redirect:    %{time_redirect}\n
    time_starttransfer: %{time_starttransfer}\n
    ----------
    time_total:       %{time_total}\n
EOF
```

---

## Emergency Escalation

If none of the above solves the problem:

1. **Collect diagnostics:**
   ```bash
   mkdir /tmp/erp-diagnostics
   systemctl status erp-system > /tmp/erp-diagnostics/systemd-status.txt
   journalctl -u erp-system -n 200 > /tmp/erp-diagnostics/systemd-logs.txt
   tail -100 /var/log/nginx/error.log > /tmp/erp-diagnostics/nginx-errors.txt
   ps aux | grep -E "node|npm|postgres" > /tmp/erp-diagnostics/processes.txt
   df -h > /tmp/erp-diagnostics/disk.txt
   free -h > /tmp/erp-diagnostics/memory.txt
   netstat -tuln > /tmp/erp-diagnostics/ports.txt
   ```

2. **Package for support:**
   ```bash
   tar -czf erp-diagnostics-$(date +%Y%m%d-%H%M%S).tar.gz /tmp/erp-diagnostics/
   ```

3. **Contact support with:**
   - Diagnostics archive
   - Description of what changed (new deployment? system update?)
   - Expected vs actual behavior
   - Timeline of when issue started

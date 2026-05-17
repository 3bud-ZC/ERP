# Step-by-Step VPS Deployment Guide

## Phase 1: VPS Initial Setup (1 hour)

### 1.1 Connect to VPS
```bash
ssh root@<VPS_IP>
```

### 1.1.1 Harden SSH
```bash
# Use SSH keys only
sudo sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#AllowUsers .*/AllowUsers erp/' /etc/ssh/sshd_config
sudo systemctl reload sshd
```

### 1.2 Update system
```bash
apt-get update && apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg lsb-release htop vim git
```

### 1.3 Install Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs
node --version  # Should be v20.x
npm --version   # Should be >= 8
```

### 1.4 Install PostgreSQL 15 (if local DB)
```bash
apt-get install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE erp_system;"
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'STRONG_PASSWORD';"
```

**Or skip if using managed PostgreSQL (RDS, Railway, Neon, etc.)**

### 1.5 Install Nginx
```bash
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx
```

### 1.6 Install Certbot for SSL
```bash
apt-get install -y certbot python3-certbot-nginx
# Certificate will be obtained in Phase 3
```

### 1.7 Install UFW firewall
```bash
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP
ufw allow 443/tcp     # HTTPS
ufw enable
```

### 1.8 Create application user
```bash
groupadd --system erp
useradd --system --gid erp --home /var/www/erp --shell /usr/sbin/nologin erp
mkdir -p /var/www/erp
mkdir -p /var/www/erp/logs
mkdir -p /var/www/erp/backups
chown -R erp:erp /var/www/erp
```

---

## Phase 2: Deploy Application Code (30 minutes)

### 2.1 Clone repository
```bash
cd /var/www/erp
sudo -u erp git clone https://github.com/YOUR_ORG/erp-system.git .
sudo -u erp git checkout final  # Main production branch
```

### 2.2 Create production `.env` file
```bash
sudo -u erp cp deployment/.env.production.example .env
nano .env  # Edit and add real values:
#   DATABASE_URL=postgresql://postgres:STRONG_PASSWORD@localhost:5432/erp_system
#   JWT_SECRET=<your-random-secret>
#   NEXTAUTH_SECRET=<your-random-secret>
#   NEXTAUTH_URL=https://your-domain.com

# Secure file permissions
chmod 640 .env
chown erp:erp .env
```

### 2.3 Install dependencies
```bash
cd /var/www/erp
sudo -u erp npm ci
```

### 2.4 Generate Prisma client
```bash
sudo -u erp npx prisma generate
```

### 2.5 Run database migrations
```bash
sudo -u erp npx prisma migrate deploy
```

**If this fails, check:**
- `DATABASE_URL` is correct
- PostgreSQL is running and accessible
- Firewall allows localhost:5432
- Database user has permissions

### 2.6 Build Next.js app
```bash
sudo -u erp npm run build
# Takes 2-5 minutes, produces .next/standalone/
```

### 2.7 Verify build output
```bash
ls -la /var/www/erp/.next/standalone/server.js
# Should show the file exists
```

---

## Phase 3: SSL Certificate Setup (20 minutes)

### 3.1 Obtain Let's Encrypt certificate
```bash
certbot certonly --nginx -d your-domain.com
# Follow prompts, certificate stored at:
#   /etc/letsencrypt/live/your-domain.com/fullchain.pem
#   /etc/letsencrypt/live/your-domain.com/privkey.pem
```

### 3.2 Update Nginx config
```bash
# Copy deployment Nginx config to system
cp /var/www/erp/deployment/nginx.conf /etc/nginx/nginx.conf

# Edit and update:
nano /etc/nginx/nginx.conf
# - Change "server_name your-domain.com" to YOUR actual domain
# - Update SSL cert paths if necessary
```

> Note: if you deploy with Docker Compose instead of a bare-metal VPS, use `deployment/nginx.docker.conf` and mount your certificate directory into `/etc/letsencrypt/live`.

### 3.3 Reload Nginx
```bash
nginx -t  # Test config syntax
systemctl reload nginx
# SSL should now be active
```

### 3.4 Verify SSL
```bash
curl -I https://your-domain.com
# Should show: HTTP/2 200
```

---

## Phase 4: Process Management Setup (Choose One)

### OPTION A: systemd (Recommended for Production)

#### 4A.1 Install systemd service
```bash
cp /var/www/erp/deployment/erp-system.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable erp-system
systemctl start erp-system
```

#### 4A.2 Verify service is running
```bash
systemctl status erp-system
journalctl -u erp-system -f  # Follow logs
curl -I http://localhost:3000  # Should show 200 OK
```

#### 4A.3 Common systemd commands
```bash
systemctl status erp-system      # Check status
systemctl restart erp-system     # Restart
systemctl stop erp-system        # Stop
systemctl logs erp-system        # View logs (modern)
journalctl -u erp-system -f      # Follow logs
```

### OPTION B: PM2 (Recommended for Development/Staging)

#### 4B.1 Install PM2 globally
```bash
npm install -g pm2
pm2 startup
pm2 save
```

#### 4B.2 Start app with PM2
```bash
cd /var/www/erp
pm2 start deployment/ecosystem.config.js --env production
pm2 save
pm2 logs erp-system  # Follow logs
```

#### 4B.3 Common PM2 commands
```bash
pm2 status              # Check all processes
pm2 restart erp-system  # Restart app
pm2 stop erp-system     # Stop app
pm2 logs erp-system     # View logs
pm2 logs erp-system -f  # Follow logs
```

---

## Phase 5: Application Health & Connectivity Tests (20 minutes)

### 5.1 Test app endpoint (internal)
```bash
curl -I http://localhost:3000
# Expected: HTTP/1.1 200 OK
```

### 5.2 Test health endpoint
```bash
curl https://your-domain.com/api/health
# Expected: { "success": true, "status": "READY" }
```

### 5.3 Test login page
```bash
curl -I https://your-domain.com/login
# Expected: HTTP/2 200
```

### 5.4 Test API with auth
```bash
# This will be interactive; open browser to:
# https://your-domain.com/login
# Log in with demo credentials
# Then test API calls
curl -b "token=COOKIE_HERE" https://your-domain.com/api/dashboard
```

### 5.5 Verify Nginx is proxying correctly
```bash
netstat -tuln | grep 3000
# Should show: tcp 127.0.0.1:3000 (localhost only)

netstat -tuln | grep 443
# Should show: tcp 0.0.0.0:443 (all interfaces)
```

---

## Phase 6: Automation & Backups (30 minutes)

### 6.1 Enable automatic SSL renewal
```bash
systemctl enable certbot.timer
systemctl start certbot.timer
# Certbot automatically renews 30 days before expiry
```

### 6.2 Setup automated backups
```bash
# Create backup cron job
echo "0 2 * * * /var/www/erp/deployment/scripts/backup.sh" | crontab -
# Backs up database daily at 2 AM
```

### 6.3 Setup log rotation
```bash
nano /etc/logrotate.d/erp-system
```

Add:
```
/var/www/erp/logs/*.log {
  daily
  rotate 30
  missingok
  compress
  delaycompress
  notifempty
}
```

### 6.4 Test backup script
```bash
sudo -u erp /var/www/erp/deployment/scripts/backup.sh
# Backup file should appear in /var/www/erp/backups/
```

---

## Phase 7: Post-Deployment Verification (20 minutes)

### 7.1 Verify all critical services
```bash
# Check PostgreSQL
sudo -u postgres psql -c "SELECT datname FROM pg_database;"

# Check Nginx
nginx -t

# Check app (systemd)
systemctl status erp-system

# Check firewall
ufw status
```

### 7.2 Monitor resource usage
```bash
htop
# Check CPU, memory, disk usage
# App should use ~100-200MB RAM
```

### 7.3 Test restart persistence
```bash
# Simulate VPS reboot
systemctl reboot
# Wait 2-3 minutes
# Reconnect and verify:
systemctl status erp-system  # Should be running
curl https://your-domain.com/api/health  # Should respond
```

### 7.4 Verify security
```bash
# Check if PostgreSQL is not exposed
netstat -tuln | grep 5432
# Should only show 127.0.0.1:5432 (localhost)

# Check file permissions
ls -la /var/www/erp/.env
# Should show: -rw-r----- erp erp

# Check UFW rules
ufw status
# Should allow: 22, 80, 443
```

---

## Phase 8: Documentation & Handoff

### 8.1 Document actual configuration
```bash
# Create a local copy of final config (no secrets)
cat /etc/nginx/nginx.conf | grep -v password > /var/www/erp/docs/nginx-final.conf
systemctl cat erp-system > /var/www/erp/docs/systemd-service-final.conf
```

### 8.2 Backup initial configuration
```bash
tar -czf /var/www/erp/backups/config-backup-$(date +%Y%m%d).tar.gz \
  /etc/nginx/ \
  /etc/systemd/system/erp-system.service \
  /var/www/erp/.env
```

### 8.3 Setup monitoring (Optional but Recommended)
- Use Uptime Robot, Healthchecks.io, or similar
- Monitor `/api/health` endpoint every 5-10 minutes
- Set up alerts (email/Slack)

---

## Troubleshooting During Deployment

| Issue | Cause | Fix |
|-------|-------|-----|
| `DATABASE_URL is not set` | Env var missing | Check `.env` file exists and is sourced |
| `Connection refused :5432` | PostgreSQL not running | `systemctl restart postgresql` |
| `EACCES: permission denied` | Wrong file permissions | `chown -R erp:erp /var/www/erp` |
| `Can't reach database` | Firewall blocked | `sudo ufw allow from localhost to any port 5432` |
| `Nginx 502 Bad Gateway` | App not running | Check `systemctl status erp-system` |
| `Certificate not found` | Certbot not configured | Run `certbot certonly --nginx -d your-domain.com` |
| `Port already in use :3000` | Conflicting process | `lsof -i :3000` then kill process |

---

## Success Checklist

- [ ] SSH access to VPS working
- [ ] Node.js and npm installed
- [ ] PostgreSQL running (or remote DB accessible)
- [ ] Nginx running and responding
- [ ] SSL certificate valid (curl -I https://domain.com shows 200)
- [ ] App code checked out in `/var/www/erp/`
- [ ] `.env` created and permissions set (640)
- [ ] Prisma migrations deployed
- [ ] App build successful
- [ ] systemd/PM2 service running
- [ ] Health endpoint responding (`/api/health`)
- [ ] UFW firewall configured (ports 22, 80, 443 only)
- [ ] PostgreSQL port NOT exposed to public (127.0.0.1 only)
- [ ] Backup script tested and working
- [ ] SSL auto-renewal enabled
- [ ] VPS survives restart cycle

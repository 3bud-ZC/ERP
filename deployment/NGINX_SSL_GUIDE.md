# Nginx + SSL/TLS Deployment Guide

## Nginx Configuration Overview

The `deployment/nginx.conf` provides:
- HTTP → HTTPS redirect (port 80 → 443)
- SSL/TLS termination with modern ciphers
- Reverse proxy to Node.js app (port 3000)
- Security headers (HSTS, CSP, X-Frame-Options, etc.)
- WebSocket support for real-time features
- Compression and caching-friendly setup

For Docker Compose, use `deployment/nginx.docker.conf` instead of `deployment/nginx.conf`.

## Installation & Setup

### 1. Install Nginx
```bash
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx
```

### 2. Copy deployment config
```bash
cp /var/www/erp/deployment/nginx.conf /etc/nginx/nginx.conf
```

### 3. Edit domain name and SSL paths
```bash
nano /etc/nginx/nginx.conf

# Find these lines and update:
# Line ~24: server_name your-domain.com;  ← YOUR ACTUAL DOMAIN
# Line ~27: ssl_certificate /etc/letsencrypt/live/your-domain/fullchain.pem;
# Line ~28: ssl_certificate_key /etc/letsencrypt/live/your-domain/privkey.pem;
```

### 4. Test syntax
```bash
nginx -t
# Should output: syntax is ok, configuration test is successful
```

### 5. Reload Nginx
```bash
systemctl reload nginx
```

---

## SSL Certificate Setup with Let's Encrypt

### Prerequisites
- Domain name registered and pointing to VPS IP
- Nginx running on port 80
- Port 80 reachable from the internet

### Steps

#### 1. Install Certbot
```bash
apt-get install -y certbot python3-certbot-nginx
```

#### 2. Obtain certificate
```bash
certbot certonly --nginx -d your-domain.com

# Follow prompts:
# - Enter email for renewals
# - Agree to terms
# - Share email (optional)
```

#### 3. Verify certificate was created
```bash
ls -la /etc/letsencrypt/live/your-domain.com/
# Should show: fullchain.pem, privkey.pem, cert.pem, chain.pem
```

#### 4. Update Nginx config with certificate paths
```bash
nano /etc/nginx/nginx.conf
# Ensure these paths match:
# ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
# ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
```

#### 5. Reload Nginx
```bash
systemctl reload nginx
```

#### 6. Test HTTPS
```bash
curl -I https://your-domain.com
# Expected: HTTP/2 200 OK

openssl s_client -connect your-domain.com:443 -tls1_3
# Shows certificate details
```

---

## SSL Certificate Auto-Renewal

### Enable Certbot auto-renewal
```bash
systemctl enable certbot.timer
systemctl start certbot.timer
```

### Verify auto-renewal is configured
```bash
systemctl status certbot.timer
# Should show: active (waiting)

certbot renew --dry-run
# Should show: no certificates to renew
```

### Manual renewal (if needed)
```bash
certbot renew --force-renewal
# Renews all certificates

# Or for specific domain:
certbot renew --cert-name your-domain.com
```

### Test renewal hook (optional)
```bash
certbot renew --dry-run --post-hook "systemctl reload nginx"
# Simulates renewal + Nginx reload
```

---

## Security Headers Explained

The Nginx config includes these security headers:

| Header | Purpose | Value |
|--------|---------|-------|
| `Strict-Transport-Security` | Force HTTPS for 1 year | `max-age=31536000; includeSubDomains; preload` |
| `X-Content-Type-Options` | Prevent MIME sniffing | `nosniff` |
| `X-Frame-Options` | Prevent clickjacking | `DENY` |
| `X-XSS-Protection` | Legacy XSS filter | `1; mode=block` |
| `Referrer-Policy` | Control referer header | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Disable dangerous APIs | `geolocation=(), microphone=(), camera=()` |
| `Content-Security-Policy` | Control resource origins | Defined in `middleware.ts` + duplicated in Nginx |
| `Cross-Origin-Resource-Policy` | Prevent cross-origin resource theft | `same-origin` |

---

## Troubleshooting Nginx

### Check Nginx status
```bash
systemctl status nginx
journalctl -u nginx -f
```

### Verify config syntax
```bash
nginx -t
```

### Check if port is already in use
```bash
lsof -i :80
lsof -i :443
# Kill conflicting processes if necessary
```

### View active connections
```bash
netstat -an | grep ESTABLISHED
```

### Test proxy to app
```bash
curl -I http://localhost:3000      # Direct to app
curl -I http://localhost/          # Via Nginx proxy
```

### Common errors and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `502 Bad Gateway` | App not running | `systemctl start erp-system` |
| `Connection refused` | App crashed | Check `systemctl status erp-system` |
| `SSL_ERROR_RX_RECORD_TOO_LONG` | HTTP on HTTPS port | Verify Nginx config points to correct SSL cert |
| `Certificate verification failed` | Invalid cert path | Check `/etc/letsencrypt/live/your-domain/` exists |
| `Too many redirects` | HTTP→HTTPS loop | Check Nginx config doesn't have double redirects |

---

## Custom Nginx Tuning (Optional)

### Increase file descriptor limits
```bash
# /etc/security/limits.conf
www-data soft nofile 65536
www-data hard nofile 65536
```

### Enable gzip compression
The default config already includes `gzip on;` but you can tune:
```bash
# In nginx.conf http block:
gzip_comp_level 6;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/json;
```

### Increase buffer sizes
```bash
proxy_buffer_size 128k;
proxy_buffers 4 256k;
proxy_busy_buffers_size 256k;
```

---

## Testing SSL/TLS Quality

### SSL Labs test (online)
```
https://www.ssllabs.com/ssltest/analyze.html?d=your-domain.com
```
Target: A+ grade

### Local certificate verification
```bash
openssl s_client -connect your-domain.com:443
# Shows: certificate chain, dates, ciphers

openssl x509 -in /etc/letsencrypt/live/your-domain.com/fullchain.pem -text -noout
# Shows: certificate details, expiry date
```

### Check certificate expiry
```bash
certbot certificates
# Lists all certificates and expiry dates

# Or manual check:
openssl x509 -enddate -noout -in /etc/letsencrypt/live/your-domain.com/cert.pem
# Expected: notAfter=2027-05-15 (in future)
```

---

## Maintenance Checklist

- [ ] Certificate expires in > 30 days (Certbot auto-renews at 30 days)
- [ ] Nginx config syntax valid (`nginx -t`)
- [ ] HTTPS working on all subdomains
- [ ] HTTP redirects to HTTPS
- [ ] SSL Labs grade is A or A+
- [ ] No mixed content warnings in browser
- [ ] HSTS header present (check with `curl -I https://domain.com | grep Strict`)

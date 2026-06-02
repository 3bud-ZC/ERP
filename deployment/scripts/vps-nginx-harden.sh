#!/usr/bin/env bash
# Harden nginx: www -> apex, IP/default -> canonical HTTPS domain
set -euo pipefail

DOMAIN="erp.abud.fun"
NGINX_SITE="/etc/nginx/sites-available/erp"
CERT="/etc/letsencrypt/live/erp.abud.fun"

cp -a "$NGINX_SITE" "${NGINX_SITE}.bak-harden-$(date +%Y%m%d_%H%M%S)"

cat > "$NGINX_SITE" <<NGINX
# Catch-all: block/redirect IP and unknown hosts
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _ 167.99.157.6;
    return 301 https://${DOMAIN}\$request_uri;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _ 167.99.157.6;
    ssl_certificate ${CERT}/fullchain.pem;
    ssl_certificate_key ${CERT}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    return 301 https://${DOMAIN}\$request_uri;
}

# www -> apex (HTTPS)
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name www.${DOMAIN};
    ssl_certificate ${CERT}/fullchain.pem;
    ssl_certificate_key ${CERT}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    return 301 https://${DOMAIN}\$request_uri;
}

# Primary application
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN};

    ssl_certificate ${CERT}/fullchain.pem;
    ssl_certificate_key ${CERT}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$http_connection;
        proxy_buffering off;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_redirect off;
    }
}

# HTTP -> HTTPS (apex + www)
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};
    return 301 https://${DOMAIN}\$request_uri;
}
NGINX

nginx -t
systemctl reload nginx
echo "NGINX_HARDEN_OK"

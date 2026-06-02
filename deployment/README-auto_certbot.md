Auto Certbot helper

Place `auto_certbot.sh` on the server (e.g., `/usr/local/bin/auto_certbot.sh`) and run as root or with sudo. The script polls DNS for `erp.abud.fun` and `www.erp.abud.fun` and, when both point to `167.99.157.6`, it will:

- validate `nginx -t`
- install `certbot` (via snap) if missing
- run `certbot --nginx -d erp.abud.fun -d www.erp.abud.fun --redirect`
- validate and reload nginx
- run `certbot renew --dry-run`

Usage example (on the server):

```bash
sudo mv /tmp/auto_certbot.sh /usr/local/bin/auto_certbot.sh
sudo chmod +x /usr/local/bin/auto_certbot.sh
sudo systemctl daemon-reload
sudo systemctl start auto-certbot.service
sudo systemctl status auto-certbot.service
```

Notes:
- Edit the `EMAIL` variable inside the script before running to set a valid contact email.
- The script starts in dry-run mode and automatically disables dry-run once both domains point to `167.99.157.6`.
- The script writes logs to `/var/log/auto_certbot.log` and the service also appends logs there.
- It does not stop or restart the ERP service; it only validates nginx and reloads it after certificate installation.
- The repository includes `deployment/auto-certbot.service` for installing as a systemd service.

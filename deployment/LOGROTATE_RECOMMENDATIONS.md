# Log Rotation and PM2 Log Management

## Recommended logrotate configuration

Create `/etc/logrotate.d/erp-system` with:

```text
/var/www/erp/logs/*.log {
  daily
  missingok
  rotate 14
  compress
  delaycompress
  copytruncate
  notifempty
  dateext
  maxage 30
}

/var/log/nginx/*.log {
  daily
  missingok
  rotate 14
  compress
  delaycompress
  notifempty
  sharedscripts
  postrotate
    [ -f /run/nginx.pid ] && kill -USR1 `cat /run/nginx.pid`
  endscript
}
```

### Notes
- `daily`: rotate logs every day.
- `rotate 14`: keep 14 rotated files in addition to the current file.
- `maxage 30`: remove archived logs older than 30 days.
- `copytruncate`: avoids restarting the Node.js process when rotating app logs.

## PM2 log file recommendations

### Configure PM2 log rotation
- Install PM2 logrotate module: `pm2 install pm2-logrotate`
- Recommended settings:
  - `max_size`: `10M`
  - `retain`: `14`
  - `compress`: `true`
  - `workerInterval`: `30`
  - `rotateInterval`: `0 0 * * *` (daily)

### Example PM2 logrotate commands
```bash
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval "0 0 * * *"
pm2 set pm2-logrotate:workerInterval 30
pm2 reload pm2-logrotate
```

## Additional disk safety
- Monitor `/var/www/erp/logs` and `/var/log/nginx` regularly.
- Use `du -sh /var/www/erp/logs/*` and `du -sh /var/log/nginx/*`.
- Consider `find /var/www/erp/backups -mtime +30 -delete` for backup pruning.

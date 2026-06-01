# Server Health Report — 2026-05-26

## Target
- Host: `159.223.167.220`
- Domain: `https://og-estore.site`
- Service: `erp-system` (systemd)
- Stack: Next.js + Prisma + PostgreSQL + Nginx

## Current Health
- API health: **healthy**
  - `/api/health`: OK
  - `/api/health/detailed`: OK
- `erp-system`: **active (running)**
- `nginx`: **active (running)**
- PostgreSQL: running and reachable

## Resource Snapshot
- CPU: `2 vCPU` (low load)
  - Load avg: `0.17 / 0.11 / 0.05`
- Memory: `3.8 GiB`
  - Used ~`818 MiB`, Available ~`3.0 GiB`
- Swap: `2.0 GiB` (used ~`111 MiB`)
- Disk (`/`): before cleanup `61%`, after cleanup **`21%`**
  - Free space increased from ~`31G` to ~`61G`

## Database Snapshot
- DB name: `erp_system_prod`
- DB size: ~`15 MB`
- Connections: `11` total, `1` active at sample time
- Largest tables are still small (AuditLog/ActivityLog/Session/JournalEntry...)

## API/HTTP Response Timings (unauthenticated probes)
- `/api/health`: ~`0.04s`
- `/api/health/detailed`: ~`0.09s`
- Protected routes return redirect/401 quickly (~`0.02s`)

## Issues Found
1. **Disk bloat from old deployment snapshots/backups**
   - Large folders under `/var/www` and `/var/www/backups` consumed significant space.
2. **Frequent `Rate limit exceeded` log entries**
   - Indicates repeated bursts (auth/general), likely bot/probe traffic or aggressive client retries.

## Fixes Applied
1. **Safe cleanup of old deployment snapshots/backups**
   - Removed stale snapshot directories:
     - `/var/www/erp_prev_*`
     - `/var/www/failed-login-fix-20260522T165313`
   - Removed heavy old backup directories under `/var/www/backups` matching:
     - `deploy-*`
     - `erp-before-*`
   - Kept active app and current backups.
2. **Installed automated retention cleanup job**
   - Script: `/usr/local/bin/erp-retention-cleanup.sh`
   - Schedule: `/etc/cron.d/erp-retention-cleanup` at `04:17` daily
   - Purpose:
     - clean stale `/tmp/erp-sync*.tar.gz`
     - prune very old pre-sync folders
     - keep only latest 40 backup files

## Risk/Capacity Assessment
- Server is currently **not overloaded**.
- CPU and memory are within safe limits.
- After cleanup, disk pressure is resolved.
- Current VPS capacity is acceptable for present load.

## Recommendations (next hardening step)
1. Add fail2ban or WAF policy for repeated auth bursts.
2. Add uptime + latency alerting (external monitor).
3. Keep daily DB backup verify/restore drill monthly.
4. Monitor rate-limit events and client retry patterns.


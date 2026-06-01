# Production Hardening Checklist (erp.abud.fun)

## Deploy Safety
- Never overwrite server `.env`.
- Run `prisma migrate deploy` only.
- Build must pass before restart.
- Run smoke script after deploy.

## Smoke Coverage
- `/api/health`
- `/api/health/detailed`
- `/login`
- `/dashboard`
- `/customers`
- `/suppliers`
- `/inventory/products`
- `/invoices/sales`
- `/manufacturing/production-orders`
- `/accounting`
- `/reports`
- `/admin`

## Monitoring
- Run `deployment/scripts/health-monitor.sh` every 5 minutes via cron.
- Keep PM2 logs rotated.

## Rollback
- Keep previous release directory.
- Rollback by switching symlink to previous release + pm2 restart.

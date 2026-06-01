#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://erp.abud.fun}"

echo "[smoke] health"
curl -fsS "$BASE_URL/api/health" >/dev/null

echo "[smoke] health detailed"
curl -fsS "$BASE_URL/api/health/detailed" >/dev/null

echo "[smoke] public pages"
for p in /login /dashboard /customers /suppliers /inventory/products /invoices/sales /manufacturing/production-orders /accounting /reports /admin; do
  code=$(curl -k -s -o /dev/null -w "%{http_code}" "$BASE_URL$p")
  if [[ "$code" != "200" && "$code" != "307" && "$code" != "302" ]]; then
    echo "FAILED $p => $code"
    exit 1
  fi
done

echo "[smoke] PASS"

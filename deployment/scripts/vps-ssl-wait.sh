#!/usr/bin/env bash
# Polls DNS; runs /tmp/vps-ssl-activate.sh once erp-abud.com resolves to VPS IP.
set -euo pipefail

TARGET_IP="159.223.167.220"
DOMAINS=("erp-abud.com" "www.erp-abud.com")
LOG="/var/log/erp-ssl-wait.log"

resolve_a() {
  dig +short A "$1" @8.8.8.8 2>/dev/null | tr -d '\r' | grep -E '^[0-9.]+$' | head -1 || true
}

while true; do
  ok=true
  for d in "${DOMAINS[@]}"; do
    ip="$(resolve_a "$d")"
    if [ "$ip" != "$TARGET_IP" ]; then
      ok=false
      echo "$(date -Is) WAIT $d -> ${ip:-NXDOMAIN}" >> "$LOG"
    fi
  done
  if $ok; then
    echo "$(date -Is) DNS ready — running SSL activation" >> "$LOG"
    if bash /tmp/vps-ssl-activate.sh >> "$LOG" 2>&1; then
      echo "$(date -Is) SSL activation succeeded" >> "$LOG"
      systemctl disable erp-ssl-wait.service 2>/dev/null || true
      exit 0
    fi
    echo "$(date -Is) SSL activation failed — will retry" >> "$LOG"
  fi
  sleep 120
done

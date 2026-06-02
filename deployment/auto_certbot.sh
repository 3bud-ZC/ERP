#!/usr/bin/env bash
set -euo pipefail

# auto_certbot.sh
# Polls DNS for two hostnames and runs certbot --nginx when both resolve to the expected IP.

DOMAINS=("erp.abud.fun" "www.erp.abud.fun")
TARGET_IP="167.99.157.6"
EMAIL="admin@erp.abud.fun"
SLEEP_SECS=180
MAX_ATTEMPTS=480  # ~24 hours by default
DRY_RUN=true
LOGFILE="/var/log/auto_certbot.log"

echo "$(date --iso-8601=seconds) starting auto_certbot" | tee -a "$LOGFILE"

check_installed() {
  command -v "$1" >/dev/null 2>&1 || return 1
}

# Prefer dig, fall back to host, then getent
resolve_a() {
  local host=$1
  if check_installed dig; then
    dig +short A "$host" @8.8.8.8 | tr -d '\r'
  elif check_installed host; then
    host -t A "$host" | awk '/has address/ {print $4}'
  else
    getent ahosts "$host" | awk '{print $1}' | uniq
  fi
}

attempt=0
while :; do
  attempt=$((attempt+1))
  echo "$(date --iso-8601=seconds) DNS check attempt $attempt" | tee -a "$LOGFILE"
  all_ok=true
  for d in "${DOMAINS[@]}"; do
    ips=$(resolve_a "$d" || true)
    if [[ -z "$ips" ]]; then
      echo "  $d -> no A records yet" | tee -a "$LOGFILE"
      all_ok=false
    else
      echo "  $d -> $ips" | tee -a "$LOGFILE"
      if ! printf '%s\n' "$ips" | grep -xq "$TARGET_IP"; then
        all_ok=false
      fi
    fi
  done

  if $all_ok ; then
    echo "$(date --iso-8601=seconds) Both domains resolve to $TARGET_IP" | tee -a "$LOGFILE"

    # Validate nginx before touching certbot
    if ! nginx -t; then
      echo "nginx -t failed, aborting" | tee -a "$LOGFILE"
      exit 1
    fi

    # Ensure certbot is installed
    if ! check_installed certbot; then
      echo "certbot not found. Attempting to install via snapd (requires sudo)." | tee -a "$LOGFILE"
      if ! check_installed snap; then
        apt update && apt install -y snapd || true
      fi
      snap install core; snap refresh core
      snap install --classic certbot
      ln -s /snap/bin/certbot /usr/bin/certbot || true
    fi

    # Perform certbot issuance with redirect (non-interactive)
    if $DRY_RUN; then
      echo "DNS propagated; disabling dry-run for real certificate issuance" | tee -a "$LOGFILE"
      DRY_RUN=false
    fi
    certbot_args=("--nginx" "-d" "${DOMAINS[0]}" "-d" "${DOMAINS[1]}" "--agree-tos" "--no-eff-email" "--email" "$EMAIL" "--redirect" "--non-interactive")
    if $DRY_RUN; then
      certbot_args+=("--dry-run")
    fi
    certbot "${certbot_args[@]}"

    # Validate nginx and reload
    if nginx -t; then
      systemctl reload nginx
    else
      echo "nginx config failed after certbot; leaving existing config" | tee -a "$LOGFILE"
      exit 1
    fi

    # Verify certificate details
    echo "Certificate summary:" | tee -a "$LOGFILE"
    certbot certificates | tee -a "$LOGFILE"

    # Check renewal
    certbot renew --dry-run | tee -a "$LOGFILE"

    echo "$(date --iso-8601=seconds) auto_certbot finished successfully" | tee -a "$LOGFILE"
    exit 0
  fi

  if [[ $attempt -ge $MAX_ATTEMPTS ]]; then
    echo "Reached max attempts ($MAX_ATTEMPTS). Exiting." | tee -a "$LOGFILE"
    exit 2
  fi

  sleep "$SLEEP_SECS"
done

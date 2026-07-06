#!/usr/bin/env bash
# Add one or more hostnames to the live nginx site's server_name directives.
#
# Idempotent and safe: backs up the config, only appends hostnames that aren't
# already listed, validates with `nginx -t`, and auto-rolls-back to the backup
# if validation fails (so a bad edit never takes the site down).
#
# Usage (run ON the EC2 box, or pipe over SSH — see repo notes):
#   sudo bash add-domain-nginx.sh openpscalc.com www.openpscalc.com
set -euo pipefail

LIVE=/etc/nginx/sites-available/openpscalc
[ "$#" -ge 1 ] || { echo "usage: $0 <hostname> [hostname...]" >&2; exit 1; }
[ -f "$LIVE" ] || { echo "not found: $LIVE" >&2; exit 1; }

NEW="$*"
BACKUP="${LIVE}.bak.$(date +%s)"
cp "$LIVE" "$BACKUP"
echo "backup: $BACKUP"

tmp="$(mktemp)"
while IFS= read -r line || [ -n "$line" ]; do
  # Only touch actual server_name directives (skip comments).
  if [[ "$line" =~ ^[[:space:]]*server_name[[:space:]] ]]; then
    add=""
    for h in $NEW; do
      grep -qwF "$h" <<<"$line" || add+=" $h"
    done
    [ -n "$add" ] && line="${line%;}$add;"
  fi
  printf '%s\n' "$line"
done < "$LIVE" > "$tmp"
cp "$tmp" "$LIVE"
rm -f "$tmp"

if nginx -t; then
  systemctl reload nginx
  echo "nginx: server_name updated -> $NEW  (reloaded)"
else
  echo "nginx -t FAILED — restoring backup" >&2
  cp "$BACKUP" "$LIVE"
  exit 1
fi

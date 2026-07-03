#!/usr/bin/env bash
# Ensures the /stats/ping and /stats/data proxy locations exist in the live
# nginx config. Uses exact-match locations so /stats (the SPA page) is still
# served by the try_files fallback.
# Safe to run repeatedly — only patches if the blocks are missing.
set -euo pipefail

LIVE=/etc/nginx/sites-available/openpscalc

if grep -q 'location = /stats/ping' "$LIVE"; then
  echo "nginx: stats proxy blocks already present, skipping"
  exit 0
fi

# Remove any broad /stats/ prefix block added by a previous deploy run.
if grep -q 'location /stats/' "$LIVE"; then
  sudo sed -i '/location \/stats\//,/}/d' "$LIVE"
fi

BLOCK='
    location = /stats/ping {
        proxy_pass http://127.0.0.1:4000/stats/ping;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /stats/data {
        proxy_pass http://127.0.0.1:4000/stats/data;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }'

# Insert the two blocks after the closing brace of the /api/ location block.
sudo awk '/location \/api\//{found=1} found && /^    \}/{print; print BLOCK; found=0; next} 1' \
  BLOCK="$BLOCK" "$LIVE" | sudo tee "$LIVE.tmp" > /dev/null
sudo mv "$LIVE.tmp" "$LIVE"

sudo nginx -t && sudo systemctl reload nginx
echo "nginx: patched and reloaded"

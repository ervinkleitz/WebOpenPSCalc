#!/usr/bin/env bash
# Ensures the /stats/ proxy block exists in the live nginx config.
# Safe to run repeatedly — only patches if the block is missing.
set -euo pipefail

LIVE=/etc/nginx/sites-available/openpscalc

if grep -q 'location /stats/' "$LIVE"; then
  echo "nginx: /stats/ block already present, skipping"
  exit 0
fi

BLOCK='
    location /stats/ {
        proxy_pass http://127.0.0.1:4000/stats/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }'

# Insert the block after the closing brace of the /api/ location block.
sudo awk '/location \/api\//{found=1} found && /^    \}/{print; print BLOCK; found=0; next} 1' \
  BLOCK="$BLOCK" "$LIVE" | sudo tee "$LIVE.tmp" > /dev/null
sudo mv "$LIVE.tmp" "$LIVE"

sudo nginx -t && sudo systemctl reload nginx
echo "nginx: patched and reloaded"

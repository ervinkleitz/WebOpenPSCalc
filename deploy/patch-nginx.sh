#!/usr/bin/env bash
# Idempotent patches to the live nginx site config, run on every deploy by
# .github/workflows/deploy.yml. Each patch checks whether it has already been
# applied, and the whole thing is validated with `nginx -t` before reload, with
# an automatic rollback to the backup if validation fails — so a bad edit can
# never take the site down.
#
#   1. /stats/ping and /stats/data proxy blocks (exact-match, so /stats itself
#      is still served as an SPA route).
#   2. Real 404s. The original config answered EVERY unknown path with 200 and
#      the app shell, which Google files as a soft 404 — stale links and typos
#      then show up in Search Console as "not indexed" pages.
set -euo pipefail

LIVE=/etc/nginx/sites-available/openpscalc
[ -f "$LIVE" ] || { echo "not found: $LIVE" >&2; exit 1; }

BACKUP="${LIVE}.bak.$(date +%s)"
sudo cp "$LIVE" "$BACKUP"
CHANGED=0

restore_and_fail() {
  echo "nginx -t FAILED — restoring $BACKUP" >&2
  sudo cp "$BACKUP" "$LIVE"
  sudo nginx -t || true
  exit 1
}

# ---------------------------------------------------------------------------
# 1. stats API proxy blocks
# ---------------------------------------------------------------------------
if grep -q 'location = /stats/ping' "$LIVE"; then
  echo "nginx: stats proxy blocks already present, skipping"
else
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
  CHANGED=1
  echo "nginx: stats proxy blocks added"
fi

# ---------------------------------------------------------------------------
# 2. Real 404s instead of the SPA shell
#
# Rewrites, in every server block that has it:
#     location / { try_files $uri /index.html; }
# into
#     location / { try_files $uri =404; }
#     location = / { try_files /index.html =404; }
#     location = /stats { try_files /index.html =404; }
#     error_page 404 /404.html;  location = /404.html { internal; }
#
# The SPA owns exactly two routes (see src/App.tsx), so those two keep the app
# shell and everything else becomes a genuine 404 against the static files.
# ---------------------------------------------------------------------------
if grep -q 'try_files $uri =404;' "$LIVE"; then
  echo "nginx: 404 fallback already present, skipping"
elif ! grep -q 'try_files $uri /index.html;' "$LIVE"; then
  echo "nginx: no SPA catch-all found to patch, skipping" >&2
else
  sudo awk '
    /^[[:space:]]*location \/ \{/ { inloc = 1; print; next }
    inloc && /try_files \$uri \/index\.html;/ {
      print "        try_files $uri =404;"; next
    }
    inloc && /^[[:space:]]*\}/ {
      print
      print ""
      print "    # The SPA owns exactly two routes; everything else is a real 404."
      print "    location = / {"
      print "        try_files /index.html =404;"
      print "    }"
      print ""
      print "    location = /stats {"
      print "        try_files /index.html =404;"
      print "    }"
      print ""
      print "    error_page 404 /404.html;"
      print "    location = /404.html {"
      print "        internal;"
      print "    }"
      inloc = 0
      next
    }
    { print }
  ' "$LIVE" | sudo tee "$LIVE.tmp" > /dev/null
  sudo mv "$LIVE.tmp" "$LIVE"
  CHANGED=1
  echo "nginx: SPA catch-all replaced with real 404s"
fi

# ---------------------------------------------------------------------------
# 3. SPA cache headers
#
# index.html was served with NO Cache-Control at all, so browsers cached it
# heuristically - while every deploy DELETES the old hashed bundles it references.
# Result, after each deploy: players with a stale index.html either kept seeing the
# previous version for hours (stale JS still in their browser cache) or got a blank
# page (old bundle evicted, server 404s it). Players repeatedly reported already-fixed
# bugs as still broken minutes after a deploy because of this.
#
# The standard SPA contract: index.html revalidates on every load (no-cache does NOT
# mean "don't store" - it means "check with the server first", a cheap 304 when
# unchanged), and the content-hashed /assets/ are immutable for a year.
# ---------------------------------------------------------------------------
if grep -q 'SPA-CACHE-HEADERS' "$LIVE"; then
  echo "nginx: SPA cache headers already present, skipping"
else
  sudo awk '
    /^[[:space:]]*location = \/ \{/ || /^[[:space:]]*location = \/stats \{/ {
      print
      if (!announced) {
        print "        # SPA-CACHE-HEADERS: the entry point must revalidate, its hashed assets never need to."
        announced = 1
      }
      print "        add_header Cache-Control \"no-cache\";"
      next
    }
    { print }
  ' "$LIVE" | sudo tee "$LIVE.tmp" > /dev/null
  sudo mv "$LIVE.tmp" "$LIVE"

  # The /assets/ block may not exist yet; add it after the /api/ block if missing.
  if ! grep -q 'location /assets/' "$LIVE"; then
    ASSETS_BLOCK='
    location /assets/ {
        # Content-hashed filenames: a changed file is a new URL, so cache forever.
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }'
    sudo awk '/location \/api\//{found=1} found && /^    \}/{print; print BLOCK; found=0; next} 1'       BLOCK="$ASSETS_BLOCK" "$LIVE" | sudo tee "$LIVE.tmp" > /dev/null
    sudo mv "$LIVE.tmp" "$LIVE"
  fi
  CHANGED=1
  echo "nginx: SPA cache headers added"
fi

if [ "$CHANGED" -eq 0 ]; then
  echo "nginx: nothing to patch"
  exit 0
fi

sudo nginx -t || restore_and_fail
sudo systemctl reload nginx
echo "nginx: patched and reloaded (backup at $BACKUP)"

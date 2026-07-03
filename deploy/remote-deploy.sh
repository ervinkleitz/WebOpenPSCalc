#!/usr/bin/env bash
# Runs ON the EC2 instance, invoked over SSH by .github/workflows/deploy.yml
# after rsync has already placed fresh backend source + frontend build there.
#
# Usage: bash remote-deploy.sh <deploy_path>
set -euo pipefail

DEPLOY_PATH="${1:?deploy path argument is required}"

cd "$DEPLOY_PATH/backend"
npm ci --omit=dev

cd "$DEPLOY_PATH"
pm2 startOrReload ecosystem.config.js
pm2 save

# Absorb nginx history into stats.ndjson (backfill on first run; fast
# incremental on subsequent runs).
mkdir -p "$DEPLOY_PATH/backend/logs"
node "$DEPLOY_PATH/backend/src/scripts/consolidate.js" \
  >> "$DEPLOY_PATH/backend/logs/consolidate.log" 2>&1 || true

# Install/refresh daily cron job (02:00 UTC).  Idempotent: removes any
# existing consolidate.js line before adding the updated one.
NODE_BIN="$(which node)"
CRON_LINE="0 2 * * * $NODE_BIN $DEPLOY_PATH/backend/src/scripts/consolidate.js >> $DEPLOY_PATH/backend/logs/consolidate.log 2>&1"
(crontab -l 2>/dev/null | grep -v 'consolidate.js'; echo "$CRON_LINE") | crontab -
echo "cron: daily consolidation scheduled via $NODE_BIN"

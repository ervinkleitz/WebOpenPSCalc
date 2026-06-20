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

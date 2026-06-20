#!/usr/bin/env bash
# One-time EC2 instance setup. Run this manually ON the instance (not by CI) —
# e.g. `ssh ec2-user@<host>`, copy this script over, then `bash setup-ec2.sh`.
# Assumes a Debian/Ubuntu AMI (uses apt-get). For Amazon Linux, swap the
# package manager calls for dnf/yum equivalents.
set -euo pipefail

DEPLOY_PATH="${1:-$HOME/openpscalc}"

echo "==> Deploy path: $DEPLOY_PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing pm2"
  sudo npm install -g pm2
  # Registers pm2 to relaunch on instance reboot.
  pm2_startup_cmd="$(pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n1)"
  eval "sudo $pm2_startup_cmd" || true
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "==> Installing nginx"
  sudo apt-get update
  sudo apt-get install -y nginx
fi

mkdir -p "$DEPLOY_PATH/backend" "$DEPLOY_PATH/frontend/dist"

if [ ! -f "$DEPLOY_PATH/backend/.env" ]; then
  GENERATED_KEY="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))' 2>/dev/null || true)"
  cat > "$DEPLOY_PATH/backend/.env" <<ENVEOF
PORT=4000
API_KEY=${GENERATED_KEY}
ENVEOF
  echo "==> Wrote $DEPLOY_PATH/backend/.env with a generated API_KEY (deploys never overwrite this file — it's excluded from rsync)."
fi

cat <<EOF

==> Base setup done.

Next steps:
1. Copy deploy/nginx.conf.example to /etc/nginx/sites-available/openpscalc on
   this box, edit "server_name" and "root" (root must be
   "$DEPLOY_PATH/frontend/dist"), then:
     sudo ln -s /etc/nginx/sites-available/openpscalc /etc/nginx/sites-enabled/openpscalc
     sudo rm -f /etc/nginx/sites-enabled/default
     sudo nginx -t && sudo systemctl reload nginx

2. Open inbound port 80 (and 443 if you add TLS) in this instance's security group.

3. In the GitHub repo, set these secrets (Settings -> Secrets and variables -> Actions):
     EC2_HOST         = this instance's public IP or DNS name
     EC2_USER         = $(whoami)
     EC2_SSH_KEY      = the private key (PEM) that can SSH in as that user
     EC2_DEPLOY_PATH  = $DEPLOY_PATH
     API_KEY          = $(cat "$DEPLOY_PATH/backend/.env" 2>/dev/null | grep API_KEY | cut -d= -f2)
                         (must exactly match $DEPLOY_PATH/backend/.env's API_KEY — the
                         workflow bakes this into the frontend build as VITE_API_KEY)

4. Push to main — .github/workflows/deploy.yml will build and deploy automatically.
EOF

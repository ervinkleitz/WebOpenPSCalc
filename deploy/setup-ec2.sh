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

# nginx runs as www-data, which can't traverse into a home directory by
# default on Ubuntu (drwxr-x---). Grant just enough to pass through to the
# deploy path — does not grant directory listing, only traversal to named
# children. Only matters if $DEPLOY_PATH is under /home/<user>.
if [[ "$DEPLOY_PATH" == "$HOME"* ]]; then
  chmod o+x "$HOME"
fi

if [ ! -f "$DEPLOY_PATH/backend/.env" ]; then
  cat > "$DEPLOY_PATH/backend/.env" <<'ENVEOF'
PORT=4000
ENVEOF
  echo "==> Wrote $DEPLOY_PATH/backend/.env (API_KEY and STATS_PASSWORD are injected by each deploy)."
fi

# A key to paste into the API_KEY GitHub secret, which is the only place it is
# configured — the deploy writes it into backend/.env and bakes it into the
# frontend build from that one value. This script used to write the key into
# .env itself and ask you to copy it into the secret by hand; the two drifted,
# the backend ended up with no key, and its gate silently let everything
# through. Nothing is written here now, so there is nothing to drift from.
#
# Fails loudly rather than printing an empty string: an empty key is how the
# original went wrong, and `|| true` is what hid it.
GENERATED_KEY="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))' 2>/dev/null \
  || openssl rand -hex 24 2>/dev/null \
  || true)"
if [ -z "$GENERATED_KEY" ]; then
  echo "!! Could not generate a key (no working node or openssl). Generate 48 hex" >&2
  echo "!! characters yourself and use that as the API_KEY secret." >&2
  GENERATED_KEY="<generate-48-hex-chars-yourself>"
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
     API_KEY          = $GENERATED_KEY
                         (paste JUST that value — not an "API_KEY=..." line. Each
                         deploy writes it to backend/.env and bakes it into the
                         frontend build as VITE_API_KEY, so this secret is the
                         only place it lives. Leave it unset to keep the gate off.)
     STATS_PASSWORD   = any password you choose, for the /stats page
                         (that endpoint fails closed — unset takes stats down)

4. Push to main — .github/workflows/deploy.yml will build and deploy automatically.
EOF

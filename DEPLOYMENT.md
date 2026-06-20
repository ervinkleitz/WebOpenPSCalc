# Deployment

CI/CD via GitHub Actions (`.github/workflows/deploy.yml`), deploying to a
single EC2 instance running the backend under pm2 and the frontend as static
files served by nginx (which also reverse-proxies `/api` to the backend).

## Architecture

```
GitHub push to main
  -> verify job: npm ci + tsc --noEmit (backend), npm ci + vite build (frontend)
  -> deploy job (only on main):
       - vite build frontend
       - rsync backend source -> EC2:$EC2_DEPLOY_PATH/backend
       - rsync frontend dist  -> EC2:$EC2_DEPLOY_PATH/frontend/dist
       - rsync ecosystem.config.js -> EC2:$EC2_DEPLOY_PATH/ecosystem.config.js
       - ssh into EC2, run deploy/remote-deploy.sh:
           npm ci --omit=dev (backend deps, on the EC2 box's own arch/OS)
           pm2 startOrReload ecosystem.config.js
           pm2 save

EC2 instance:
  nginx :80 -> static files from $EC2_DEPLOY_PATH/frontend/dist
            -> proxies /api/* to http://127.0.0.1:4000/api/*
  pm2 process "openpscalc-backend" -> tsx src/server.ts (PORT=4000)
```

Backend dependencies are installed **on the EC2 box itself** (not copied from
the GitHub Actions runner) so native modules match the instance's actual
OS/architecture.

## One-time EC2 setup

1. SSH into the instance, copy `deploy/setup-ec2.sh` over, run it:
   ```
   scp deploy/setup-ec2.sh ec2-user@<host>:~/
   ssh ec2-user@<host> 'bash setup-ec2.sh ~/openpscalc'
   ```
   This installs Node 20, pm2, nginx, and creates the deploy directory.
   Assumes a Debian/Ubuntu AMI (apt-get); adjust for Amazon Linux (dnf/yum).

2. Configure nginx using `deploy/nginx.conf.example` as a template (the
   script prints the exact steps at the end).

3. Open inbound port 80 (and 443 if you terminate TLS) in the instance's
   security group.

4. Set these **GitHub repo secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `EC2_HOST` | Instance public IP or DNS |
   | `EC2_USER` | SSH user (e.g. `ubuntu`, `ec2-user`) |
   | `EC2_SSH_KEY` | Private key (PEM) that can SSH in as that user |
   | `EC2_DEPLOY_PATH` | Deploy directory on the instance, e.g. `/home/ubuntu/openpscalc` |
   | `API_KEY` | Must exactly match `API_KEY` in `$EC2_DEPLOY_PATH/backend/.env` on the box (`setup-ec2.sh` generates and prints it) |

   `EC2_DEPLOY_PATH` isn't sensitive — fine as a repo *variable* instead of a
   secret if you prefer, just keep the name the same or update the workflow.

5. Push to `main`. The workflow builds, deploys, and restarts the backend
   automatically from then on.

## API key gate

`server.ts` rejects any `/api/*` request (except `/api/health`) that doesn't
carry a matching `X-API-Key` header, **only if `API_KEY` is set** in the
backend's environment — unset, it's a no-op (kept that way so local dev needs
no setup). The frontend sends this header on every request, reading the key
from `VITE_API_KEY`, which Vite inlines into the built JS bundle.

**This is not real authentication.** Vite inlines `VITE_API_KEY` as a literal
string in the shipped bundle — anyone who loads the page, opens devtools, or
just `curl`s the JS file can read it. What it actually does: stop the API
from being casually called by tools/scripts that never load the frontend at
all (scrapers, stray bots hitting `/api/calculate` directly). It does not
stop someone who's willing to extract the key from the bundle and replay it.
If you need real protection against abuse (rate limiting, scraping,
DDoS), that's a different, larger piece of work — ask for it explicitly.

`setup-ec2.sh` generates a random key into `backend/.env` on first run and
prints it so you can copy it into the `API_KEY` GitHub secret. The deploy
workflow's rsync step excludes `.env`, so redeploys never touch it.

## Day to day

- **Every push/PR**: the `verify` job runs typecheck + build for both
  projects. Catches breakage before it ever reaches EC2.
- **Push to `main` only**: `deploy` job runs after `verify` passes.
- **Manual run**: Actions tab → "CI/CD" → "Run workflow" (workflow_dispatch).
- **Logs on the box**: `pm2 logs openpscalc-backend`, `pm2 status`.
- **Rollback**: there's no automated rollback — `git revert` the bad commit
  (or push an older commit to `main`) and let the pipeline redeploy it.

## Local dry-run of the remote script

`deploy/remote-deploy.sh` is plain bash and takes the deploy path as its only
argument, so you can test it manually over SSH without touching GitHub
Actions:

```
ssh ec2-user@<host> 'bash -s' -- /home/ubuntu/openpscalc < deploy/remote-deploy.sh
```

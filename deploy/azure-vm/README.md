# Deploy Envirolytics to an Azure VM (Ubuntu)

This guide sets up the full app on a single Ubuntu 22.04 (or 24.04) Azure VM:

```
┌────────────────────────── Azure VM ──────────────────────────┐
│                                                              │
│   nginx  :80/:443    ─────────────►    /api/*  → :8001       │
│                      ─────────────►    /       → React build │
│                                                              │
│   gunicorn + uvicorn :8001 (systemd service)                 │
│                                                              │
│   Persistent disk mount:                                     │
│     /opt/envirolytics/backend/uploads/  (photos + videos)    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
        ▲
        │  mongodb+srv://
        ▼
   MongoDB Atlas (Azure region)
```

## 0. Prerequisites

- Azure VM: **Ubuntu 22.04 LTS**, at least **2 vCPU / 4 GB RAM / 30 GB disk**
- Inbound ports open in the VM's Network Security Group: **22, 80, 443**
- A domain (e.g. `monitor.envirolytics.in`) whose A record points to the VM's public IP
- Your MongoDB Atlas cluster URI (with a database user + IP allow-listing of the VM's public IP)

## 1. Base OS setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git python3.11 python3.11-venv python3.11-dev \
                    build-essential nginx certbot python3-certbot-nginx \
                    curl ca-certificates gnupg

# Node LTS (for the React build)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g yarn

# Dedicated system user
sudo useradd --system --home /opt/envirolytics --shell /usr/sbin/nologin envirolytics
sudo mkdir -p /opt/envirolytics /var/log/envirolytics
sudo chown -R envirolytics:envirolytics /opt/envirolytics /var/log/envirolytics
```

## 2. Pull the code

```bash
sudo -u envirolytics -H git clone https://github.com/<your-fork>/envirolytics.git /opt/envirolytics/src
sudo -u envirolytics -H cp -r /opt/envirolytics/src/backend  /opt/envirolytics/backend
sudo -u envirolytics -H cp -r /opt/envirolytics/src/frontend /opt/envirolytics/frontend
```

*(Or `rsync -av` the code from wherever you keep it. Whatever ships the same layout as this repo works.)*

## 3. Backend — Python venv + env file

```bash
sudo -u envirolytics -H python3.11 -m venv /opt/envirolytics/venv
sudo -u envirolytics -H /opt/envirolytics/venv/bin/pip install --upgrade pip
sudo -u envirolytics -H /opt/envirolytics/venv/bin/pip install -r /opt/envirolytics/backend/requirements.txt
sudo -u envirolytics -H /opt/envirolytics/venv/bin/pip install gunicorn

# Configure environment (see .env.example in this directory)
sudo -u envirolytics -H cp /opt/envirolytics/src/deploy/azure-vm/.env.example \
                           /opt/envirolytics/backend/.env
sudo -u envirolytics -H nano /opt/envirolytics/backend/.env   # fill in MONGO_URL, JWT_SECRET, SMTP_PASSWORD, etc.
sudo chmod 600 /opt/envirolytics/backend/.env

# Persistent upload directories
sudo -u envirolytics -H mkdir -p /opt/envirolytics/backend/uploads/{aeration,camera,instrument_photos,certificates}
```

## 4. Backend — systemd service

```bash
sudo cp /opt/envirolytics/src/deploy/azure-vm/envirolytics-backend.service \
        /etc/systemd/system/envirolytics-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now envirolytics-backend
sudo systemctl status envirolytics-backend --no-pager
curl -s http://127.0.0.1:8001/api/health && echo   # should print {"status":"ok",...}
```

If `curl` fails, `sudo journalctl -u envirolytics-backend -n 100 --no-pager` will tell you why (usually a missing env var).

## 5. Frontend — build the React bundle

The frontend is a **static build**. Set the backend URL BEFORE building:

```bash
sudo -u envirolytics -H tee /opt/envirolytics/frontend/.env <<EOF
REACT_APP_BACKEND_URL=https://monitor.envirolytics.in
EOF

cd /opt/envirolytics/frontend
sudo -u envirolytics -H yarn install --frozen-lockfile
sudo -u envirolytics -H yarn build            # produces /opt/envirolytics/frontend/build
```

Any time you change the domain or update the code, rerun steps 3-5's copies + `yarn build`.

## 6. nginx reverse proxy

```bash
sudo cp /opt/envirolytics/src/deploy/azure-vm/nginx.conf \
        /etc/nginx/sites-available/envirolytics
# Edit server_name if not using monitor.envirolytics.in
sudo nano /etc/nginx/sites-available/envirolytics
sudo ln -sf /etc/nginx/sites-available/envirolytics /etc/nginx/sites-enabled/envirolytics
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

At this point the site is reachable at `http://<VM-public-IP>` (HTTP only).

## 7. HTTPS with Let's Encrypt

```bash
sudo certbot --nginx -d monitor.envirolytics.in --agree-tos --redirect \
             --email admin@envirolytics.com
```

Certbot injects the `ssl_certificate` + `ssl_certificate_key` lines into the nginx conf and installs a systemd renewal timer.  Verify:

```bash
sudo certbot renew --dry-run
curl -sI https://monitor.envirolytics.in | head -1     # HTTP/2 200
```

## 8. Restore data from the previous Emergent deployment

If Emergent Support delivers a `mongodump` archive:

```bash
# From your laptop or the VM
mongorestore --uri "$MONGO_URL" --nsInclude="envirolytics.*" ./dump/
```

Verify:

```bash
mongosh "$MONGO_URL" --eval 'db.getSiblingDB("envirolytics").users.countDocuments({})'
```

## 9. Operational cheat sheet

| Task                                | Command                                                     |
|-------------------------------------|-------------------------------------------------------------|
| Tail backend logs                    | `sudo journalctl -u envirolytics-backend -f`               |
| Restart backend                      | `sudo systemctl restart envirolytics-backend`              |
| Redeploy frontend                    | `cd /opt/envirolytics/frontend && sudo -u envirolytics -H yarn build` then `sudo systemctl reload nginx` |
| Rotate JWT secret                    | Edit `.env`, restart backend — all sessions invalidated    |
| Backup uploads                       | `rsync -a /opt/envirolytics/backend/uploads/ /mnt/backup/` |
| Backup Mongo                         | Enable point-in-time backup in Atlas (built-in)            |
| Add a new alert recipient email      | `POST /api/notifications/recipients` (admin only)           |

## 10. What is NOT needed on Azure VM

Compared to the Emergent-managed setup, you can safely leave these blank:

- `EMERGENT_LLM_KEY` — used only for Emergent-hosted object storage.
  On Azure VM the disk is persistent, so uploads survive service restarts
  and OS reboots automatically. If you ever move to Azure App Service
  (ephemeral disk) or a multi-VM setup, wire in Azure Blob Storage — the
  swap is a single module (`object_storage.py`) so it's a ~1-hour change.

## 11. Monitoring (optional but recommended)

- Azure Monitor + Log Analytics agent → collects the `/var/log/envirolytics/*.log` files
- Uptime probe on `https://monitor.envirolytics.in/api/health` every 5 min
- Atlas free tier already includes DB-level alerts (connections, IOPS)

---

### Troubleshooting

**502 Bad Gateway** – backend isn't running or is listening on a different port. Check `sudo systemctl status envirolytics-backend` and `journalctl -u envirolytics-backend -n 100 --no-pager`.

**Uploads returning "spinner forever"** – confirm the upload directory is writable by the `envirolytics` user: `ls -la /opt/envirolytics/backend/uploads/` should show ownership `envirolytics:envirolytics`.

**CORS errors from the browser** – make sure `REACT_APP_BACKEND_URL` in `frontend/.env` matches the domain the browser is hitting. If they mismatch the browser will block XHRs.

**"Invalid username/email or password" on a known account** – you're on a fresh DB with only the seed admin. Restore from the Emergent dump (step 8) before creating users manually.

---

## 12. Auto-deploy from GitHub (CI/CD)

The `.github/workflows/deploy-azure-vm.yml` workflow already lives in this repo. On every push to `main` it will:

1. Sanity-check the backend imports + build the React bundle in a clean Ubuntu runner.
2. SSH into your VM, `git pull`, install any new deps, rebuild the frontend, restart the backend, reload nginx.
3. Curl `/api/health` up to 10× until the backend reports "ok" — if not, the workflow fails visibly and prints the last 80 lines of systemd logs.

### One-time setup — takes about 3 minutes

**Step A — generate an SSH deploy keypair.** (An ed25519 pair was already generated for you during the initial deploy conversation; use that one. Otherwise regenerate locally: `ssh-keygen -t ed25519 -C envirolytics-github-deploy -N "" -f envirolytics_deploy_ed25519`)

**Step B — install the PUBLIC key on the VM.** SSH in as `envirolytics` (or as `azureuser` and `sudo -u envirolytics`), then:

```bash
sudo -u envirolytics -H mkdir -p /opt/envirolytics/.ssh
echo "<paste-public-key-here>" | sudo -u envirolytics tee -a /opt/envirolytics/.ssh/authorized_keys
sudo -u envirolytics chmod 700 /opt/envirolytics/.ssh
sudo -u envirolytics chmod 600 /opt/envirolytics/.ssh/authorized_keys
```

**Step C — grant `envirolytics` sudo for the exact commands the workflow runs.** Create `/etc/sudoers.d/envirolytics-deploy`:

```
envirolytics ALL=(root) NOPASSWD: /usr/bin/rsync -a --delete --exclude .env --exclude uploads/ backend/ /opt/envirolytics/backend/, \
                                   /usr/bin/rsync -a --delete --exclude .env --exclude build/ --exclude node_modules/ frontend/ /opt/envirolytics/frontend/, \
                                   /usr/bin/rsync -a /opt/envirolytics/src/deploy/azure-vm/nginx.conf /etc/nginx/sites-available/envirolytics, \
                                   /usr/bin/rsync -a /opt/envirolytics/src/deploy/azure-vm/envirolytics-backend.service /etc/systemd/system/envirolytics-backend.service, \
                                   /usr/bin/chown -R envirolytics:envirolytics /opt/envirolytics/backend, \
                                   /usr/bin/chown -R envirolytics:envirolytics /opt/envirolytics/frontend, \
                                   /usr/bin/systemctl daemon-reload, \
                                   /usr/bin/systemctl restart envirolytics-backend, \
                                   /usr/sbin/nginx -t, \
                                   /usr/bin/systemctl reload nginx, \
                                   /usr/bin/journalctl -u envirolytics-backend *
```

Then `sudo visudo -c` to validate.

**Step D — add GitHub Actions secrets.** In your repo → *Settings → Secrets and variables → Actions → New repository secret*:

| Name | Value |
|---|---|
| `AZURE_VM_HOST` | VM public IP or DNS (e.g. `40.121.x.x`) |
| `AZURE_VM_USER` | `envirolytics` (or `azureuser` — must match Step B) |
| `AZURE_VM_SSH_KEY` | **The entire PRIVATE key**, `-----BEGIN OPENSSH PRIVATE KEY-----` through `-----END OPENSSH PRIVATE KEY-----` |
| `AZURE_VM_PORT` | `22` (only set if you changed the default SSH port) |

**Step E — verify.** Trigger a manual run: repo → *Actions → Deploy to Azure VM → Run workflow*. Expect ~3-4 min end-to-end. The health check should pass on the first attempt.

### After that

Every merge to `main` triggers a fresh deploy. No manual VM touching, no ssh sessions, no forgotten `yarn build`. If a deploy fails, GitHub Actions shows you exactly which command failed and prints the backend logs from that moment.

### Rolling back a bad deploy

```bash
# From your laptop
git revert <bad-commit-sha> && git push origin main
```

The workflow triggers automatically on the revert commit and puts the previous known-good state live within ~3 min.


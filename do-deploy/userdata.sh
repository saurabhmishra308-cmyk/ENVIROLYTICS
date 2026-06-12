#!/bin/bash
# =============================================================================
# DigitalOcean Droplet user-data script for Envirolytics Monitor
# Paste this into "Add initialization scripts (user data)" when creating the
# Droplet, OR run it manually on a fresh Ubuntu 24.04 server.
#
# Tested on:  Ubuntu 24.04 / s-2vcpu-4gb / BLR1 (Bangalore)
# What it does:
#   1. Creates a 2 GB swap file (prevents OOM during yarn build).
#   2. Installs Docker + Docker Compose plugin.
#   3. Clones the application repo (REPO_URL below).
#   4. Boots the stack with docker compose.
#   5. Configures log rotation + automatic security updates.
#
# Before you launch the Droplet:
#   • Edit REPO_URL below to point at your GitHub repository.
#   • Have your .env file ready to SCP after the Droplet is up.
# =============================================================================

set -euxo pipefail

REPO_URL="https://github.com/<your-username>/envirolytics-monitor.git"
APP_DIR="/opt/envirolytics"

# -------- 1. Swap file (huge stability win on small droplets) --------
if ! swapon --show | grep -q '/swapfile'; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    # Reasonable swappiness for an app server
    sysctl -w vm.swappiness=10
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-envirolytics-swap.conf
fi

# -------- 2. Install Docker on Ubuntu 24.04 --------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw unattended-upgrades

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# -------- 3. Basic firewall (UFW) --------
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# -------- 4. Clone repo --------
mkdir -p "$APP_DIR"
cd /opt
if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR" && git pull
else
    git clone "$REPO_URL" envirolytics
fi

# -------- 5. Stub .env (real one will be SCP'd later) --------
if [ ! -f "$APP_DIR/aws-deploy/.env" ]; then
    cp "$APP_DIR/aws-deploy/.env.example" "$APP_DIR/aws-deploy/.env"
    echo "[envirolytics] WARN: aws-deploy/.env is the example. SCP your real .env before stack will work."
fi
chmod 600 "$APP_DIR/aws-deploy/.env"

# -------- 6. Log rotation (prevents disk fill from chatty containers) --------
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker

# -------- 7. Automatic security updates --------
dpkg-reconfigure -plow unattended-upgrades || true

# -------- 8. Boot the stack (will be a no-op until .env is populated) --------
cd "$APP_DIR"
docker compose -f aws-deploy/docker-compose.yml --env-file aws-deploy/.env up -d --build || \
    echo "[envirolytics] First build may fail until you SCP a real .env — that's fine."

echo "[envirolytics] cloud-init complete. Next: SCP your aws-deploy/.env and re-run 'docker compose up -d'."

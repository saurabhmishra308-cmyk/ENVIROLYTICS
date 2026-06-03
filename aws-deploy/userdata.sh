#!/bin/bash
# =============================================================================
# EC2 cloud-init userdata script for Envirolytics Monitor
# Paste this entire script into "Advanced details → User data" when launching
# an Amazon Linux 2023 (or Ubuntu 22.04) instance in the AWS console.
#
# Tested on:  t3.small / ap-south-1 / Amazon Linux 2023
# What it does:
#   1. Installs Docker + Docker Compose plugin.
#   2. Clones the application repo (REPO_URL below).
#   3. Pulls aws-deploy/.env from AWS SSM Parameter Store (recommended for secrets).
#   4. Builds and starts the stack with docker compose.
#
# Before you launch:
#   • Edit REPO_URL below to point at your private/public repo.
#   • If using SSM, attach an IAM role with SSM:GetParameter access to the EC2.
#   • Otherwise, comment out the SSM block and SCP your .env after boot.
# =============================================================================

set -euxo pipefail

REPO_URL="https://github.com/<your-org>/envirolytics-monitor.git"
APP_DIR="/opt/envirolytics"
SSM_ENV_PARAM="/envirolytics/prod/env"          # SSM SecureString parameter name (optional)
AWS_REGION="ap-south-1"

# -------- 1. Install Docker --------
if command -v dnf >/dev/null 2>&1; then
    # Amazon Linux 2023
    dnf update -y
    dnf install -y docker git
    systemctl enable --now docker
    # Install docker compose plugin manually for AL2023
    DOCKER_CONFIG=${DOCKER_CONFIG:-/usr/local/lib/docker}
    mkdir -p $DOCKER_CONFIG/cli-plugins
    curl -sSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
        -o $DOCKER_CONFIG/cli-plugins/docker-compose
    chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose
else
    # Ubuntu 22.04
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg git
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
fi

# -------- 2. Clone repo --------
mkdir -p "$APP_DIR"
cd /opt
git clone "$REPO_URL" envirolytics || (cd "$APP_DIR" && git pull)

# -------- 3. Fetch .env from SSM (optional but recommended) --------
if command -v aws >/dev/null 2>&1; then
    aws ssm get-parameter \
        --name "$SSM_ENV_PARAM" \
        --with-decryption \
        --region "$AWS_REGION" \
        --query "Parameter.Value" \
        --output text > "$APP_DIR/aws-deploy/.env" || {
            echo "[warn] Could not fetch $SSM_ENV_PARAM from SSM. Falling back to example."
            cp "$APP_DIR/aws-deploy/.env.example" "$APP_DIR/aws-deploy/.env"
        }
else
    cp "$APP_DIR/aws-deploy/.env.example" "$APP_DIR/aws-deploy/.env"
fi

chmod 600 "$APP_DIR/aws-deploy/.env"

# -------- 4. Build and start --------
cd "$APP_DIR"
docker compose -f aws-deploy/docker-compose.yml --env-file aws-deploy/.env up -d --build

# Configure log rotation for the docker daemon so disks don't fill
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker || true

echo "[envirolytics] bootstrap complete — visit https://$DOMAIN"

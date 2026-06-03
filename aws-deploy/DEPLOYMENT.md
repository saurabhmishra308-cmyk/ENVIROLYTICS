# AWS Deployment Guide — Envirolytics Monitor

End-to-end deployment of the Envirolytics Monitor stack on AWS using:

| Component        | Choice                                                           |
| ---------------- | ---------------------------------------------------------------- |
| Compute          | **Single EC2 + Docker Compose** (t3.small, Amazon Linux 2023)    |
| Database         | **MongoDB Atlas free tier (M0)**                                 |
| HTTPS / Domain   | **Caddy** with automatic Let's Encrypt                           |
| File storage     | **Docker volume on EBS** (cert uploads persist across restarts)  |
| Region           | **ap-south-1 (Mumbai)**                                          |

Total monthly cost (rough): **~$15–25 USD** (t3.small + 20 GB EBS + data transfer).

---

## 0) Files in this directory

| File                  | Purpose                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `Dockerfile.backend`  | FastAPI + uvicorn image                                                  |
| `Dockerfile.frontend` | React build → Caddy server (multi-stage, serves static + proxies /api)   |
| `Caddyfile`           | Reverse-proxy + auto-HTTPS configuration                                 |
| `docker-compose.yml`  | Wires both containers + named volumes                                    |
| `.env.example`        | Template for production secrets — copy to `.env` and edit                |
| `userdata.sh`         | EC2 cloud-init script: installs Docker, clones repo, boots the stack    |

---

## 1) Prerequisites (~10 minutes)

1. **AWS account** with billing enabled. Switch region to **ap-south-1 (Mumbai)** in the top-right.
2. **A domain name** (e.g. from Route 53, GoDaddy, Cloudflare). Required for HTTPS.
3. **MongoDB Atlas account** — free signup at <https://www.mongodb.com/cloud/atlas>.
4. **OpenWeatherMap API key** — free signup at <https://openweathermap.org/api> (you already have one).
5. **HiveMQ Cloud broker** with active credentials (see `IOT_DEVICE_CONFIGURATION_GUIDE.md`).

---

## 2) MongoDB Atlas (~5 minutes)

1. Sign in at <https://cloud.mongodb.com> → **Build a Database** → **M0 Free**.
2. Provider: **AWS**, Region: **Mumbai (ap-south-1)**.
3. Cluster name: `envirolytics-prod`. Create.
4. **Database Access** → Add database user
   * Username: `envirolytics`
   * Password: click "Autogenerate" and **copy it** — you'll paste it into `.env`.
   * Privileges: *Atlas admin*.
5. **Network Access** → Add IP address
   * For the simplest start: `0.0.0.0/0` (allow from anywhere).
   * Better security: add only your EC2 Elastic IP after step 4.
6. **Databases** → **Connect** → **Drivers** → copy the connection string.
   * It looks like `mongodb+srv://envirolytics:<password>@envirolytics-prod.xxxxx.mongodb.net/?retryWrites=true&w=majority`.
   * Replace `<password>` with your real password, URL-encoded (`!` → `%21`, etc.).

---

## 3) Launch the EC2 instance (~5 minutes)

In the AWS Console (region **ap-south-1**):

1. **EC2** → **Launch instances**.
2. **Name:** `envirolytics-prod`.
3. **AMI:** *Amazon Linux 2023 (64-bit x86)*.
4. **Instance type:** `t3.small` (2 vCPU / 2 GB RAM is enough to start).
5. **Key pair:** create new or pick an existing one — needed for SSH.
6. **Network settings → Edit → Security group:**
   * Allow `SSH (22)` from **your IP**.
   * Allow `HTTP (80)` from `0.0.0.0/0` (needed for Let's Encrypt validation).
   * Allow `HTTPS (443)` from `0.0.0.0/0`.
7. **Storage:** 20 GB gp3 EBS.
8. **Advanced details → User data:** paste the entire contents of `userdata.sh`.
   * **Important:** edit the `REPO_URL` at the top to point at your Git repository where this code lives.
   * If you prefer to upload code manually instead of `git clone`, leave the script as-is and SCP later.
9. **Launch instance**.

Once running:

10. Click the instance → **Networking → Allocate Elastic IP → Associate**. Note the IP.
11. Add a DNS **A record** in your domain registrar: `envirolytics.yourdomain.com → <Elastic IP>`.

---

## 4) Configure production secrets

Two options — pick one.

### Option A — Quick & simple (manual upload)

```bash
scp -i <your-key.pem> aws-deploy/.env.example ec2-user@<elastic-ip>:/tmp/.env
ssh -i <your-key.pem> ec2-user@<elastic-ip>
sudo mv /tmp/.env /opt/envirolytics/aws-deploy/.env
sudo nano /opt/envirolytics/aws-deploy/.env       # edit values
sudo chmod 600 /opt/envirolytics/aws-deploy/.env
cd /opt/envirolytics
sudo docker compose -f aws-deploy/docker-compose.yml --env-file aws-deploy/.env up -d --build
```

### Option B — Production (AWS SSM Parameter Store)

1. Locally craft your full `.env` file based on `.env.example`.
2. Upload it as a SecureString to SSM:
   ```bash
   aws ssm put-parameter \
       --region ap-south-1 \
       --name "/envirolytics/prod/env" \
       --type SecureString \
       --value "$(cat .env)" \
       --overwrite
   ```
3. Attach an IAM role to the EC2 instance with permission to read this parameter:
   * **IAM → Roles → Create role** → trusted entity *EC2*.
   * Inline policy: `ssm:GetParameter` on `arn:aws:ssm:ap-south-1:<acct>:parameter/envirolytics/*` and `kms:Decrypt` on the default `aws/ssm` key.
   * Attach the role to the EC2 instance (Actions → Security → Modify IAM role).
4. `sudo systemctl restart cloud-init` or just `sudo /var/lib/cloud/scripts/per-instance/userdata.sh` — the script will pull `.env` from SSM on next boot.

Set these in your `.env` before bringing the stack up:

| Variable             | Example                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `DOMAIN`             | `envirolytics.example.com`                                           |
| `ACME_EMAIL`         | `admin@example.com`                                                  |
| `MONGO_URL`          | `mongodb+srv://envirolytics:PASS@cluster.xxxxx.mongodb.net/?...`     |
| `DB_NAME`            | `envirolytics`                                                       |
| `JWT_SECRET`         | output of `openssl rand -hex 64`                                     |
| `ADMIN_PASSWORD`     | a strong, unique password                                            |
| `MQTT_*`             | your HiveMQ Cloud credentials                                        |
| `REACT_APP_WEATHER_API_KEY` | your OpenWeatherMap key                                       |

---

## 5) Verify the deployment

After ~2–3 minutes (image build + Let's Encrypt issuance), visit:

```
https://envirolytics.yourdomain.com
```

You should land on the **Envirolytics login page** with a green padlock 🔒.

Useful commands on the instance:

```bash
# All container statuses
sudo docker compose -f /opt/envirolytics/aws-deploy/docker-compose.yml ps

# Tail backend logs
sudo docker logs -f envirolytics_backend

# Tail Caddy / frontend logs (Let's Encrypt activity also shows here)
sudo docker logs -f envirolytics_web

# Smoke-test the API directly from the host
curl http://localhost/api/
```

---

## 6) Day-2 operations

### Updates / new code
```bash
ssh ec2-user@<elastic-ip>
cd /opt/envirolytics
sudo git pull
sudo docker compose -f aws-deploy/docker-compose.yml --env-file aws-deploy/.env up -d --build
```

### Backup MongoDB
Atlas runs continuous backups on M2+ tiers. On the M0 free tier, schedule:
```bash
mongodump --uri "$MONGO_URL" --db envirolytics --gzip --archive=/backup/$(date +%F).gz
```
…and sync the file to an **S3 bucket** with lifecycle rules.

### Backup certificate uploads (Docker volume `cert_files`)
```bash
# One-shot tarball
sudo docker run --rm -v envirolytics_cert_files:/data -v $(pwd):/backup alpine \
    tar czf /backup/certs-$(date +%F).tgz -C /data .
# …then push to S3.
```

### Rotate secrets
1. Edit `.env` (or SSM parameter).
2. `sudo docker compose -f aws-deploy/docker-compose.yml --env-file aws-deploy/.env up -d`
   (rolling restart of containers).

### Increase capacity
* For more traffic: stop the instance, change the type to `t3.medium` / `m6i.large`, start.
* For >1 backend instance: migrate to **ECS Fargate** (task definition is straightforward — backend image just needs `MONGO_URL` and `CERT_STORAGE_DIR=` pointing at an **EFS mount**).

---

## 7) Cost summary (~ap-south-1, on-demand)

| Item                              | Monthly       |
| --------------------------------- | ------------- |
| EC2 t3.small (24×7)               | $15.30        |
| EBS 20 GB gp3                     | $1.60         |
| Elastic IP (attached)             | free          |
| Data transfer out (first 100 GB)  | $9.00         |
| MongoDB Atlas M0                  | $0            |
| **Total**                         | **~$25 / mo** |

Tighten further:
* Use `t4g.small` (ARM) → ~$12/mo (rebuild images with `--platform linux/arm64`).
* Reserve an EC2 instance for 1 year → ~40 % discount.

---

## 8) Troubleshooting

| Symptom                                      | Likely cause / fix                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Caddy log: `tls obtain failed`**           | DNS A record not pointing to your Elastic IP yet, **or** port 80/443 not open in the security group.                                |
| **Login returns 500**                         | Check `docker logs envirolytics_backend` — usually a `MONGO_URL` typo or Atlas IP allowlist missing your EC2 IP.                    |
| **`MQTT Connection failed with code 5`**      | HiveMQ Cloud credentials are not active. See `IOT_DEVICE_CONFIGURATION_GUIDE.md` section 1.                                          |
| **Uploaded certs disappear after `docker compose down`** | You used `-v` which wipes named volumes. Use `docker compose stop` / `start` for routine restarts.                          |
| **Need to wipe and reseed admin user**       | `docker exec -it envirolytics_backend python -c "import asyncio; from server import db; from api_auth import seed_admin; asyncio.run(seed_admin(db))"` (or change `ADMIN_PASSWORD` in `.env` and restart). |

---

## 9) Migrating later to ECS Fargate

When you outgrow a single EC2 the migration is straightforward:

1. Push both images to **Amazon ECR** (`docker push <acct>.dkr.ecr.ap-south-1.amazonaws.com/envirolytics-{backend,web}:latest`).
2. Create an **ECS cluster** (Fargate).
3. Task definitions:
   * **backend** task: image, env vars from SSM (same `.env` keys), an **EFS mount** at `/data/certificate_files`.
   * **web** task: image, env vars `DOMAIN` + `ACME_EMAIL`. Behind an **ALB** with an ACM cert (Caddy is replaced by ALB + ACM for TLS, but you can also keep Caddy in front for ease).
4. Service auto-scaling on CPU/memory.
5. Reuse the same MongoDB Atlas cluster (or upgrade to M10).

All the code is identical — only the runtime moves.

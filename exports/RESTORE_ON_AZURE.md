# Restore Emergent MongoDB → Azure VM MongoDB

This bundle contains a full snapshot of the Emergent Cloud MongoDB database
(source DB name: `test_database`) plus all uploaded assets on disk (logos,
NOC certificates, instrument photos, aeration, camera thumbnails).

## Contents

```
mongo_dump/test_database/*.bson        # All collections (users, devices, audit_log, ...)
uploads/                               # Backend uploaded files (logos/certs/photos)
RESTORE_ON_AZURE.md                    # This file
```

## Collections included (with document counts at export time)

| Collection | Count |
|---|---|
| users | 1 |
| instrument_registry | 2 |
| flowmeter_categories | 3 |
| camera_streams | 4 |
| audit_log | 126 |
| notification_settings | 1 |
| notification_state | 5 |
| renewal_reminders_state | 2 |
| client_password_otp | 6 |
| admin_otp | 2 |
| login_attempts | 10 |
| (empty collections also dumped for schema parity) | 0 |

> ⚠️ Only 1 `users` document exists on the Emergent DB right now — the
> `admin@envirolytics.com` account. If more accounts existed on another
> environment, run this same export procedure there.

## Restore on the Azure VM

Prerequisites on the VM:

```bash
sudo apt-get install -y mongodb-database-tools
# MongoDB must already be running locally OR you have a MONGO_URL to a managed instance
```

### 1. Copy the archive to the VM

From your local machine (once you download `emergent_mongo_export.tar.gz`):

```bash
scp emergent_mongo_export.tar.gz azureuser@<VM_IP>:/tmp/
ssh azureuser@<VM_IP>
cd /tmp && tar -xzf emergent_mongo_export.tar.gz
cd emergent_mongo_export
```

### 2. Restore MongoDB

Replace `<TARGET_DB>` with the DB name you use on the VM (must match
`DB_NAME` in `/app/backend/.env`, typically `envirolytics` or
`test_database`):

```bash
# Local MongoDB (default port 27017, no auth)
mongorestore \
  --uri="mongodb://localhost:27017" \
  --nsFrom="test_database.*" \
  --nsTo="<TARGET_DB>.*" \
  --drop \
  mongo_dump

# Or, MongoDB with auth / Atlas
mongorestore \
  --uri="mongodb://<user>:<pass>@<host>:27017/?authSource=admin" \
  --nsFrom="test_database.*" \
  --nsTo="<TARGET_DB>.*" \
  --drop \
  mongo_dump
```

Flags explained:
- `--nsFrom / --nsTo` rewrites the DB name so you can rename `test_database`
  to whatever your Azure environment uses.
- `--drop` clears any pre-existing collections of the same name to avoid
  duplicates. Remove it if you want to merge.

### 3. Restore uploaded files

The backend expects files at `/app/backend/uploads/`. Copy them across:

```bash
sudo mkdir -p /app/backend/uploads
sudo cp -r uploads/* /app/backend/uploads/
sudo chown -R azureuser:azureuser /app/backend/uploads
```

### 4. Verify

```bash
mongosh "$MONGO_URL" --eval 'use <TARGET_DB>; db.users.countDocuments(); db.audit_log.countDocuments();'
sudo systemctl restart envirolytics-backend
curl http://localhost:8001/api/health
```

You should see `{ "status": "ok" }` and be able to log in with the same
admin credentials that work on the Emergent preview.

## Re-running this export

On the Emergent side, anytime you want a fresh snapshot:

```bash
cd /app && bash exports/dump.sh
# Produces /app/exports/emergent_mongo_export.tar.gz
```

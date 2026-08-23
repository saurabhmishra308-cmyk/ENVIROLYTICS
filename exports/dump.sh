#!/usr/bin/env bash
# Snapshots the current Emergent MongoDB + uploaded files into
# /app/exports/emergent_mongo_export.tar.gz
# Safe to re-run — it always overwrites the previous export.

set -euo pipefail

APP_DIR="/app"
EXPORT_DIR="${APP_DIR}/exports"
BUNDLE_DIR="${EXPORT_DIR}/emergent_mongo_export"
ARCHIVE="${EXPORT_DIR}/emergent_mongo_export.tar.gz"

MONGO_URL="$(grep '^MONGO_URL=' ${APP_DIR}/backend/.env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
DB_NAME="$(grep '^DB_NAME=' ${APP_DIR}/backend/.env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"

echo "▶ Dumping MongoDB db=${DB_NAME}"
rm -rf "${BUNDLE_DIR}" "${ARCHIVE}"
mkdir -p "${BUNDLE_DIR}/mongo_dump"
mongodump --uri="${MONGO_URL}" --db="${DB_NAME}" --out="${BUNDLE_DIR}/mongo_dump" --quiet

echo "▶ Copying uploaded files (logos, certs, photos)"
if [ -d "${APP_DIR}/backend/uploads" ]; then
  cp -r "${APP_DIR}/backend/uploads" "${BUNDLE_DIR}/uploads"
else
  mkdir -p "${BUNDLE_DIR}/uploads"
fi

echo "▶ Copying restore instructions"
cp "${EXPORT_DIR}/RESTORE_ON_AZURE.md" "${BUNDLE_DIR}/RESTORE_ON_AZURE.md"

echo "▶ Compressing archive"
tar -C "${EXPORT_DIR}" -czf "${ARCHIVE}" emergent_mongo_export

echo
echo "✅ Export complete: ${ARCHIVE}"
du -sh "${ARCHIVE}"
echo
echo "Collections captured:"
ls "${BUNDLE_DIR}/mongo_dump/${DB_NAME}/" | grep '\.bson$' | sed 's/\.bson$//' | sort

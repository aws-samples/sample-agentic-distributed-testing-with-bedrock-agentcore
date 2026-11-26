#!/usr/bin/env bash
#
# Makes sure the Docker volume that holds the sample app's database exists.
# docker-compose.yml mounts it read-only into the backend and agent-runtime-local
# (for the default CardDemo database connection) as an external volume, and
# Compose refuses to start when an external volume is missing. Creating an empty
# volume is harmless: the sample app fills it when it starts (./init-sample-app.sh).
#
# The volume name is SAMPLE_APP_DB_VOLUME (shell, then .env), default
# sample-app_db-data: the sample app's `db-data` volume under Compose project "sample-app".
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

from_env_file=""
[ -f .env ] && from_env_file="$(grep -E '^SAMPLE_APP_DB_VOLUME=' .env | tail -1 | cut -d= -f2- | tr -d "\"' " || true)"
name="${SAMPLE_APP_DB_VOLUME:-${from_env_file:-sample-app_db-data}}"

docker volume inspect "$name" >/dev/null 2>&1 || { docker volume create "$name" >/dev/null; echo "[init-sample-volume] created volume $name"; }

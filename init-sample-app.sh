#!/usr/bin/env bash
#
# Starts the CardDemo sample app (Spring Boot + React) in Docker — the
# application under test. Frontend :8020, backend API :8021.
#
# Usage:
#   ./init-sample-app.sh             # build + start
#   ./init-sample-app.sh --down      # stop (keeps images and data)
#   ./init-sample-app.sh --destroy   # remove containers, network, DB volume and images
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log()  { printf '\033[1;36m[init-sample-app]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[init-sample-app]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[init-sample-app]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is required"

case "${1:-}" in
  "")      ;;
  --down)  log "Stopping sample-app"; (cd sample-app && docker compose down); exit 0 ;;
  --destroy) log "Removing sample-app containers, network, volumes and images"; (cd sample-app && docker compose down --rmi local --volumes); exit 0 ;;
  -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)       die "Unknown flag: $1 (see --help)" ;;
esac

log "Building and starting sample app (CardDemo)"
(cd sample-app && docker compose up --build -d)
log "Sample app: http://localhost:8020 (frontend)  http://localhost:8021 (backend API)"

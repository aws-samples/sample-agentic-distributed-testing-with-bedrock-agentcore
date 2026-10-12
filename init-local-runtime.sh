#!/usr/bin/env bash
#
# Starts agent-runtime-local (OpenCode + chrome-devtools-mcp + local Chromium)
# in Docker on :4020. Used when the orchestration platform's Settings has
# Agent Mode = Local Runtime. `npm run build` also starts it via docker compose.
#
# Usage:
#   ./init-local-runtime.sh             # build + start
#   ./init-local-runtime.sh --down      # stop (keeps the image)
#   ./init-local-runtime.sh --destroy   # remove the container and its image
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log()  { printf '\033[1;36m[init-local-runtime]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[init-local-runtime]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[init-local-runtime]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is required"

case "${1:-}" in
  "")      ;;
  --down)  log "Stopping agent-runtime-local"; docker compose rm -sf agent-runtime-local; exit 0 ;;
  --destroy)
    log "Removing agent-runtime-local container and image"
    # Look the image up before removing the container, then delete it. Only this
    # service is touched, not the platform's backend/frontend containers.
    image="$(docker compose images -q agent-runtime-local 2>/dev/null | head -1 || true)"
    docker compose rm -sf agent-runtime-local
    [ -n "$image" ] && docker rmi "$image" || true
    exit 0 ;;
  -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)       die "Unknown flag: $1 (see --help)" ;;
esac

log "Building and starting agent-runtime-local (Docker)"
docker compose up --build -d agent-runtime-local
log "agent-runtime-local: http://localhost:4020"

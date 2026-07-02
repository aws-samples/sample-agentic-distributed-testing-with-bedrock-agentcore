#!/usr/bin/env bash
#
# Automates Mode 1 (dev) from the README: sample-app + testrunner as sibling
# Docker containers on this host, plus an optional one-time AgentCore
# Runtime deploy if you want AGENT_MODE=agentcore instead of local.
#
# This is NOT the Mode 2 (prod) flow — for EKS + ALB + CloudFront, see
# deploy-prod.sh instead. This script only touches local Docker state
# (and, with --with-agentcore, provisions real AWS resources for the
# AgentCore Runtime — everything else here is free and fully reversible).
#
# AgentCore is double-gated: .env's ENABLE_AGENTCORE must be true (this is
# also what the backend and frontend Settings modal check to decide whether
# to expose agentcore as a mode at all — see backend/src/state/store.js and
# frontend/src/components/SettingsModal.jsx) AND you must pass
# --with-agentcore. ENABLE_AGENTCORE=false skips the deploy step even if
# --with-agentcore is passed, so flipping it off is enough to guarantee this
# script never touches AWS.
#
# Usage:
#   ./deploy-local.sh                  # sample-app + testrunner, local agent mode
#   ./deploy-local.sh --sample-app     # sample-app only
#   ./deploy-local.sh --testrunner     # testrunner only (sample-app must already be running)
#   ./deploy-local.sh --with-agentcore # also deploy agent-runtime-agentcore to AWS
#                                      # (only if ENABLE_AGENTCORE=true in .env),
#                                      # wire AGENTCORE_RUNTIME_ARN into .env, and
#                                      # bring the testrunner up with AGENT_MODE=agentcore
#   ./deploy-local.sh --down           # stop + remove containers from both stacks
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DO_SAMPLE_APP=1
DO_TESTRUNNER=1
DO_AGENTCORE=0
DO_DOWN=0

log()  { printf '\033[1;36m[deploy-local]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy-local]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[deploy-local]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --sample-app)     DO_SAMPLE_APP=1; DO_TESTRUNNER=0 ;;
    --testrunner)     DO_SAMPLE_APP=0; DO_TESTRUNNER=1 ;;
    --with-agentcore) DO_AGENTCORE=1 ;;
    --down)           DO_DOWN=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^#//'
      exit 0
      ;;
    *) die "Unknown flag: $arg (see --help)" ;;
  esac
done

ensure_env() {
  if [ ! -f .env ]; then
    log "No .env found — copying from .env.example"
    cp .env.example .env
    warn "Review .env and adjust TARGET_URL / BEDROCK_MODEL / etc. before your next run."
  fi
}

# set_env_var NAME VALUE — updates NAME=VALUE in .env in place, or appends it
# if the key isn't present yet. Used to auto-fill AGENTCORE_RUNTIME_ARN (and
# flip AGENT_MODE/ENABLE_AGENTCORE) after a successful agentcore deploy, so
# you never have to copy an ARN out of terminal output by hand.
set_env_var() {
  local name="$1" value="$2"
  if grep -q "^${name}=" .env; then
    sed -i "s|^${name}=.*|${name}=${value}|" .env
  else
    printf '%s=%s\n' "$name" "$value" >> .env
  fi
}

# Reads ENABLE_AGENTCORE from .env (defaulting to false if unset/missing) —
# the single source of truth for whether this deployment offers AgentCore at
# all, shared with the backend (ENABLE_AGENTCORE env var — see
# backend/src/state/store.js) and the frontend Settings modal.
agentcore_enabled_in_env() {
  ensure_env
  local val
  val="$(grep -E '^ENABLE_AGENTCORE=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
  [ "$val" = "true" ]
}

if [ "$DO_AGENTCORE" = "1" ] && ! agentcore_enabled_in_env; then
  warn "--with-agentcore was passed but ENABLE_AGENTCORE is not true in .env — skipping the AgentCore deploy."
  warn "Set ENABLE_AGENTCORE=true in .env first if you actually want this."
  DO_AGENTCORE=0
fi

check_prereqs() {
  local missing=()
  command -v docker >/dev/null 2>&1 || missing+=("docker")
  if [ ${#missing[@]} -gt 0 ]; then
    die "Missing required tools: ${missing[*]}"
  fi
  if [ "$DO_AGENTCORE" = "1" ]; then
    command -v npm       >/dev/null 2>&1 || die "npm is required for --with-agentcore"
    command -v npx       >/dev/null 2>&1 || die "npx is required for --with-agentcore"
    command -v agentcore >/dev/null 2>&1 || die "agentcore CLI not found on PATH (npm install -g @aws/agentcore) — required for --with-agentcore"
    command -v python3   >/dev/null 2>&1 || die "python3 is required for --with-agentcore (parses the deployed runtime ARN)"
  fi
}

down_sample_app() {
  log "Stopping sample-app"
  (cd sample-app && docker compose down)
}

down_testrunner() {
  log "Stopping testrunner (backend + frontend + agent-runtime-local)"
  docker compose --profile local down
}

up_sample_app() {
  log "═══ Sample app (CardDemo) ═══"
  (cd sample-app && docker compose up --build -d)
  log "Sample app: http://localhost:8020 (frontend)  http://localhost:8021 (backend API)"
}

# Deploys agent-runtime-agentcore to AWS AgentCore Runtime and writes the
# resulting ARN + AGENT_MODE=agentcore + ENABLE_AGENTCORE=true into .env —
# matches the manual flow documented under "AgentCore Deployment" in the
# root README, just automated end-to-end. This is the only part of this
# script that touches real AWS infrastructure.
deploy_agentcore() {
  log "═══ AgentCore Runtime (AWS) ═══"
  local agentcore_dir="$SCRIPT_DIR/agent-runtime-agentcore/agentcore"
  [ -d "$agentcore_dir" ] || die "agent-runtime-agentcore/agentcore not found"

  log "npm install (agent-runtime-agentcore/agentcore/cdk)"
  (cd "$agentcore_dir/cdk" && npm install)

  log "agentcore deploy"
  (cd "$agentcore_dir" && npx agentcore deploy)

  # The `agentcore` CLI writes the definitive runtime ARN to its own state
  # file after every successful deploy — read that instead of scraping CLI
  # stdout (whose format isn't a stable contract). agentcore.json's
  # runtimes[0].name is the target name inside that file's "resources.runtimes"
  # map, and "default" is the CLI's default deploy target (see
  # aws-targets.json) — both hold regardless of account/region.
  local state_file="$agentcore_dir/.cli/deployed-state.json"
  [ -f "$state_file" ] || die "agentcore deploy did not produce $state_file — check its output above for errors."

  local arn
  arn="$(python3 -c "
import json
d = json.load(open('$state_file'))
runtimes = d['targets']['default']['resources']['runtimes']
name = json.load(open('$agentcore_dir/agentcore.json'))['runtimes'][0]['name']
print(runtimes[name]['runtimeArn'])
" 2>/dev/null || true)"

  if [ -z "$arn" ]; then
    warn "Could not read the deployed runtime ARN from $state_file."
    warn "Copy it manually into .env as AGENTCORE_RUNTIME_ARN=... and re-run with --testrunner."
    return 1
  fi

  log "Deployed AgentCore Runtime: $arn"
  ensure_env
  set_env_var AGENTCORE_RUNTIME_ARN "$arn"
  set_env_var AGENT_MODE agentcore
  set_env_var ENABLE_AGENTCORE true
  log "Wired AGENTCORE_RUNTIME_ARN, AGENT_MODE=agentcore, and ENABLE_AGENTCORE=true into .env"
}

up_testrunner() {
  log "═══ Testrunner (backend + frontend$([ "$DO_AGENTCORE" = "0" ] && echo ' + agent-runtime-local')) ═══"
  ensure_env
  if [ "$DO_AGENTCORE" = "1" ]; then
    # AGENT_MODE=agentcore routes execution to AWS — no local agent-runtime
    # container needed, so skip the 'local' compose profile entirely.
    docker compose up --build -d backend frontend
  else
    docker compose --profile local up --build -d
  fi
  log "Testrunner: http://localhost:5175"
  log "  If sample-app is running, set Target URL to http://localhost:8020 from Settings"
  log "  (or set TARGET_URL in .env before the next run)."
}

check_prereqs

if [ "$DO_DOWN" = "1" ]; then
  down_sample_app
  down_testrunner
  log "Done."
  exit 0
fi

[ "$DO_SAMPLE_APP" = "1" ] && up_sample_app
[ "$DO_AGENTCORE" = "1" ] && deploy_agentcore
[ "$DO_TESTRUNNER" = "1" ] && up_testrunner

log "Done."

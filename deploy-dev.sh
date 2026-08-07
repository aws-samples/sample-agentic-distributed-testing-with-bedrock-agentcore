#!/usr/bin/env bash
#
# Automates the infra half of Mode 1 (dev) from the README: sample-app
# (Docker — Spring Boot + Maven) and, by default, a one-time deploy of
# agent-runtime-agentcore to AWS AgentCore Runtime (real AWS resources,
# costs money while the Runtime exists) — pass --local to skip AWS entirely.
#
# This does NOT run the testrunner itself (backend/frontend) — run those
# yourself with `npm run dev:backend` / `npm run dev:frontend` from the repo
# root (see /package.json) in your own terminal(s). Running them directly
# rather than backgrounded by this script means editor tooling (e.g. VS
# Code's port auto-forwarding, which watches a terminal's own output for the
# "Local: http://..." line) picks them up correctly.
#
# This is NOT the Mode 2 (prod) flow — for EKS + ALB + CloudFront, see
# deploy-prod.sh instead. This script only touches sample-app's Docker
# state, plus (by default) the one-time AgentCore Runtime deploy above.
#
# Whether this script touches AWS is controlled by --local alone — pass it
# to skip the AgentCore deploy entirely and stay local-only.
#
# Usage:
#   ./deploy-dev.sh              # sample-app + AgentCore Runtime deploy (default)
#   ./deploy-dev.sh --local      # sample-app + agent-runtime-local (Docker), no AWS calls
#   ./deploy-dev.sh --down       # stop sample-app + agent-runtime-local (leaves any
#                                 # deployed AgentCore Runtime running in AWS)
#   ./deploy-dev.sh --destroy    # --down, plus tear down the AgentCore Runtime
#                                 # in AWS if one was deployed (the Mode 1
#                                 # counterpart to deploy-prod.sh <target> --destroy)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DO_AGENTCORE=1
DO_DOWN=0
DO_DESTROY=0

log()  { printf '\033[1;36m[deploy-dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy-dev]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[deploy-dev]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --local)          DO_AGENTCORE=0 ;;
    --down)           DO_DOWN=1 ;;
    --destroy)        DO_DOWN=1; DO_DESTROY=1 ;;
    -h|--help)
      sed -n '2,29p' "$0" | sed 's/^#//'
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
# flip AGENT_MODE) after a successful agentcore deploy, so you never have to
# copy an ARN out of terminal output by hand.
set_env_var() {
  local name="$1" value="$2"
  if grep -q "^${name}=" .env; then
    sed -i "s|^${name}=.*|${name}=${value}|" .env
  else
    printf '%s=%s\n' "$name" "$value" >> .env
  fi
}

# aws-targets.json ships checked into git with a placeholder account ID
# ("000000000000" — see the file's own "description" field) since a real
# account number shouldn't be committed. If it's still the placeholder (e.g.
# a fresh clone, or a `git checkout` that reset a local edit), CDK tries to
# assume a deploy role in that nonexistent account and fails. Keep it synced
# to whatever account the current AWS credentials resolve to, and to .env's
# BROWSER_REGION (the var that governs AgentCore Runtime/Browser region
# everywhere else in this project — see .env.example) — NOT the ambient
# AWS_REGION/AWS_DEFAULT_REGION env var, which the agentcore CLI falls back
# to on its own and can silently point a deploy at the wrong region if it
# differs from what .env says.
ensure_agentcore_account() {
  local agentcore_dir="$1"
  local targets_file="$agentcore_dir/aws-targets.json"
  [ -f "$targets_file" ] || return 0

  local account region
  account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
  [ -z "$account" ] && { warn "Could not resolve AWS account via 'aws sts get-caller-identity' — leaving $targets_file as-is."; return 1; }
  region="$(grep -E '^BROWSER_REGION=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -z "$region" ] && region="ap-southeast-1"

  python3 -c "
import json
p = '$targets_file'
d = json.load(open(p))
changed = False
for t in d:
    if t.get('account') != '$account':
        t['account'] = '$account'
        changed = True
    if t.get('region') != '$region':
        t['region'] = '$region'
        changed = True
if changed:
    json.dump(d, open(p, 'w'), indent=2)
    print('updated')
"
}

check_prereqs() {
  local missing=()
  command -v docker >/dev/null 2>&1 || missing+=("docker")
  if [ ${#missing[@]} -gt 0 ]; then
    die "Missing required tools: ${missing[*]}"
  fi
  if [ "$DO_AGENTCORE" = "1" ] || [ "$DO_DESTROY" = "1" ]; then
    command -v npm       >/dev/null 2>&1 || die "npm is required for agentcore mode (or pass --local)"
    command -v npx       >/dev/null 2>&1 || die "npx is required for agentcore mode (or pass --local)"
    command -v agentcore >/dev/null 2>&1 || die "agentcore CLI not found on PATH (npm install -g @aws/agentcore) — required for agentcore mode (or pass --local)"
    command -v python3   >/dev/null 2>&1 || die "python3 is required for agentcore mode (parses the deployed runtime ARN)"
    command -v aws        >/dev/null 2>&1 || die "aws CLI is required for agentcore mode (resolves your account ID for aws-targets.json)"
  fi
}

down_sample_app() {
  log "Stopping sample-app"
  (cd sample-app && docker compose down)
}

up_sample_app() {
  log "═══ Sample app (CardDemo) ═══"
  (cd sample-app && docker compose up --build -d)
  log "Sample app: http://localhost:8020 (frontend)  http://localhost:8021 (backend API)"
}

# agent-runtime-local (OpenCode + chrome-devtools-mcp + local Chromium) is
# behind docker-compose.yml's "local" profile — plain `docker compose up`
# never starts it, so --local drives it explicitly here. Also flips
# AGENT_MODE=local into .env, mirroring what deploy_agentcore does for the
# agentcore case, so .env and the running mode actually agree.
up_local_runtime() {
  log "═══ agent-runtime-local (Docker) ═══"
  docker compose --profile local up --build -d agent-runtime-local
  log "agent-runtime-local: http://localhost:4020"
  ensure_env
  set_env_var AGENT_MODE local
  log "Wired AGENT_MODE=local into .env"
}

# Counterpart to up_local_runtime — a no-op if it was never started (the
# "local" profile scopes this to just that one container, and docker
# compose down on an absent container warns but exits 0).
down_local_runtime() {
  log "Stopping agent-runtime-local"
  docker compose --profile local down agent-runtime-local
}

# Runs `npx agentcore deploy [args...]` from $1 (the agentcore project root)
# and verifies it actually succeeded by reading the per-run log it just
# wrote under .cli/logs/deploy/, rather than trusting its process exit code.
# Observed in practice: this CLI can exit 0 while its own log ends "FAILED"
# (e.g. a region/state mismatch where deployed-state.json still pointed at a
# stack in a different region than aws-targets.json) — trusting exit status
# alone let a failed deploy fall through and read the ARN from a stale
# previous deploy, silently wiring a wrong/outdated ARN into .env.
run_agentcore_deploy_verified() {
  local agentcore_dir="$1"; shift
  local logs_dir="$agentcore_dir/.cli/logs/deploy"
  local before_log
  before_log="$(ls -1t "$logs_dir" 2>/dev/null | head -1 || true)"

  (cd "$agentcore_dir/.." && npx agentcore deploy "$@") || true

  local latest_log
  latest_log="$(ls -1t "$logs_dir" 2>/dev/null | head -1 || true)"
  if [ -z "$latest_log" ] || [ "$latest_log" = "$before_log" ]; then
    warn "agentcore deploy did not produce a new log under $logs_dir — check its output above for errors."
    return 1
  fi
  if ! tail -5 "$logs_dir/$latest_log" | grep -q "COMPLETED SUCCESSFULLY"; then
    warn "agentcore deploy failed — see $logs_dir/$latest_log for details."
    return 1
  fi
}

# Deploys agent-runtime-agentcore to AWS AgentCore Runtime and writes the
# resulting ARN + AGENT_MODE=agentcore into .env — matches the manual flow
# documented under "AgentCore Deployment" in the root README, just automated
# end-to-end. This is the only part of this script that touches real AWS
# infrastructure.
deploy_agentcore() {
  log "═══ AgentCore Runtime (AWS) ═══"
  local agentcore_dir="$SCRIPT_DIR/agent-runtime-agentcore/agentcore"
  [ -d "$agentcore_dir" ] || die "agent-runtime-agentcore/agentcore not found"

  ensure_env
  ensure_agentcore_account "$agentcore_dir"

  log "npm install (agent-runtime-agentcore/agentcore/cdk)"
  (cd "$agentcore_dir/cdk" && npm install)

  log "agentcore deploy"
  # Run from the project root (one level up from agentcore/), not agentcore/
  # itself — this CLI version enforces cwd == project root for `deploy`.
  # agentcore.json's codeLocation ("app") resolves relative to this same
  # root — see agent-runtime-agentcore/app/ (Dockerfile + package.json +
  # src/, deliberately kept separate from agentcore/'s CDK tooling: this
  # CLI zips codeLocation as a raw CDK asset with no filtering, so anything
  # under agentcore/ — including its own actively-growing cdk.out build
  # output — must never be inside it).
  run_agentcore_deploy_verified "$agentcore_dir" || die "agentcore deploy failed — .env was left untouched."

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
    warn "Copy it manually into .env as AGENTCORE_RUNTIME_ARN=..."
    return 1
  fi

  log "Deployed AgentCore Runtime: $arn"
  ensure_env
  set_env_var AGENTCORE_RUNTIME_ARN "$arn"
  set_env_var AGENT_MODE agentcore
  log "Wired AGENTCORE_RUNTIME_ARN and AGENT_MODE=agentcore into .env"
}

# Tears down the AgentCore Runtime deployed by deploy_agentcore, if any —
# the remove-then-redeploy flow documented by the agentcore CLI itself
# (agent-runtime-agentcore/agentcore/node_modules/@aws/agentcore's
# AGENTS.md): removing the runtime from agentcore.json and re-running
# `agentcore deploy` destroys the underlying CDK stack. agentcore.json is
# checked into git, so this restores it afterward — otherwise the working
# tree would end up dirty, and a future deploy-dev.sh run would have
# nothing left to redeploy.
destroy_agentcore() {
  local agentcore_dir="$SCRIPT_DIR/agent-runtime-agentcore/agentcore"
  local state_file="$agentcore_dir/.cli/deployed-state.json"

  if [ ! -f "$state_file" ] || ! python3 -c "
import json, sys
d = json.load(open('$state_file'))
sys.exit(0 if d.get('targets') else 1)
" 2>/dev/null; then
    log "No deployed AgentCore Runtime found — nothing to destroy in AWS."
    return 0
  fi

  local runtime_name
  runtime_name="$(python3 -c "import json; print(json.load(open('$agentcore_dir/agentcore.json'))['runtimes'][0]['name'])" 2>/dev/null || true)"
  if [ -z "$runtime_name" ]; then
    warn "Could not read runtime name from agentcore.json — skipping AgentCore teardown."
    warn "Destroy it manually: cd $agentcore_dir && npx agentcore remove agent --name <name> -y && npx agentcore deploy -y"
    return 1
  fi

  log "═══ Tearing down AgentCore Runtime '$runtime_name' (AWS) ═══"

  ensure_env
  ensure_agentcore_account "$agentcore_dir"

  local backup
  backup="$(mktemp)"
  cp "$agentcore_dir/agentcore.json" "$backup"

  if ! (cd "$agentcore_dir" && npx agentcore remove agent --name "$runtime_name" -y); then
    warn "agentcore remove agent failed — leaving agentcore.json untouched."
    rm -f "$backup"
    return 1
  fi

  # Run from the project root (one level up from agentcore/), not agentcore/
  # itself — this CLI version enforces cwd == project root for `deploy`
  # (unlike `remove agent` above, which works from either). See
  # run_agentcore_deploy_verified for why we check its log instead of exit code.
  if ! run_agentcore_deploy_verified "$agentcore_dir" -y; then
    warn "agentcore deploy (teardown) failed — restoring agentcore.json. The AWS stack may still exist; check the AWS console."
    cp "$backup" "$agentcore_dir/agentcore.json"
    rm -f "$backup"
    return 1
  fi

  cp "$backup" "$agentcore_dir/agentcore.json"
  rm -f "$backup"
  log "AgentCore Runtime destroyed; agentcore.json restored for future deploys."
}

check_prereqs

if [ "$DO_DOWN" = "1" ]; then
  down_sample_app
  down_local_runtime
  [ "$DO_DESTROY" = "1" ] && destroy_agentcore
  log "Done."
  exit 0
fi

up_sample_app
if [ "$DO_AGENTCORE" = "1" ]; then
  deploy_agentcore
else
  up_local_runtime
fi

log "Done."
log "Now run the testrunner yourself: npm run dev:backend / npm run dev:frontend (from the repo root)"

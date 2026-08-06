#!/usr/bin/env bash
#
# Automates Mode 1 (dev) from the README: sample-app + testrunner as sibling
# Docker containers on this host. Defaults to AGENT_MODE=agentcore, which
# means a plain run deploys agent-runtime-agentcore to AWS AgentCore Runtime
# (real AWS resources, costs money while the Runtime exists) — pass --local
# to skip AWS entirely and use the agent-runtime-local container instead.
#
# This is NOT the Mode 2 (prod) flow — for EKS + ALB + CloudFront, see
# deploy-prod.sh instead. This script only touches local Docker state, plus
# (by default) the one-time AgentCore Runtime deploy described above.
#
# AgentCore is double-gated: .env's ENABLE_AGENTCORE must be true (this is
# also what the backend and frontend Settings modal check to decide whether
# to expose agentcore as a mode at all — see backend/src/state/store.js and
# frontend/src/components/SettingsModal.jsx) AND --local must not be passed.
# ENABLE_AGENTCORE=false skips the AWS deploy step even without --local, so
# flipping it off is enough to guarantee this script never touches AWS.
#
# Usage:
#   ./deploy-dev.sh                 # sample-app + testrunner, agentcore agent mode (default)
#   ./deploy-dev.sh --local         # same, but local agent mode (no AWS calls)
#   ./deploy-dev.sh --sample-app    # sample-app only
#   ./deploy-dev.sh --testrunner    # testrunner only (sample-app must already be running)
#   ./deploy-dev.sh --down          # stop + remove containers from both stacks (leaves
#                                    # any deployed AgentCore Runtime running in AWS)
#   ./deploy-dev.sh --destroy       # --down, plus tear down the AgentCore Runtime in AWS
#                                    # if one was deployed (the Mode 1 counterpart to
#                                    # deploy-prod.sh <target> --destroy)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DO_SAMPLE_APP=1
DO_TESTRUNNER=1
DO_AGENTCORE=1
DO_DOWN=0
DO_DESTROY=0

log()  { printf '\033[1;36m[deploy-dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy-dev]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[deploy-dev]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --sample-app)     DO_SAMPLE_APP=1; DO_TESTRUNNER=0 ;;
    --testrunner)     DO_SAMPLE_APP=0; DO_TESTRUNNER=1 ;;
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
  warn "Defaulting to agentcore, but ENABLE_AGENTCORE is not true in .env — skipping the AgentCore deploy and falling back to local agent mode."
  warn "Set ENABLE_AGENTCORE=true in .env first if you actually want agentcore, or pass --local to silence this."
  DO_AGENTCORE=0
fi

# aws-targets.json ships checked into git with a placeholder account ID
# ("000000000000" — see the file's own "description" field) since a real
# account number shouldn't be committed. If it's still the placeholder (e.g.
# a fresh clone, or a `git checkout` that reset a local edit), CDK tries to
# assume a deploy role in that nonexistent account and fails. Keep it synced
# to whatever account the current AWS credentials resolve to, so deploy/
# destroy always target the right place without a manual edit first.
ensure_agentcore_account() {
  local agentcore_dir="$1"
  local targets_file="$agentcore_dir/aws-targets.json"
  [ -f "$targets_file" ] || return 0

  local account
  account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
  [ -z "$account" ] && { warn "Could not resolve AWS account via 'aws sts get-caller-identity' — leaving $targets_file as-is."; return 1; }

  python3 -c "
import json
p = '$targets_file'
d = json.load(open(p))
changed = False
for t in d:
    if t.get('account') != '$account':
        t['account'] = '$account'
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

  ensure_agentcore_account "$agentcore_dir"

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
  # (unlike `remove agent` above, which works from either). Safe to do only
  # because agentcore.json now has an empty runtimes list after the remove
  # above: no container to build means no Dockerfile/codeLocation resolution
  # happens, so this can't hit the codeLocation path-resolution bug that
  # affects a fresh (non-teardown) deploy on this CLI version.
  if ! (cd "$agentcore_dir/.." && npx agentcore deploy -y); then
    warn "agentcore deploy (teardown) failed — restoring agentcore.json. The AWS stack may still exist; check the AWS console."
    cp "$backup" "$agentcore_dir/agentcore.json"
    rm -f "$backup"
    return 1
  fi

  cp "$backup" "$agentcore_dir/agentcore.json"
  rm -f "$backup"
  log "AgentCore Runtime destroyed; agentcore.json restored for future deploys."
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
  [ "$DO_DESTROY" = "1" ] && destroy_agentcore
  log "Done."
  exit 0
fi

[ "$DO_SAMPLE_APP" = "1" ] && up_sample_app
[ "$DO_AGENTCORE" = "1" ] && deploy_agentcore
[ "$DO_TESTRUNNER" = "1" ] && up_testrunner

log "Done."

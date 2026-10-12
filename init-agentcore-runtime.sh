#!/usr/bin/env bash
#
# One-time deploy of agent-runtime-agentcore to AWS AgentCore Runtime (real AWS
# resources, costs money while it exists). Writes the resulting runtime ARN into
# .env as AGENTCORE_RUNTIME_ARN. Re-run it after changing agent-runtime-agentcore/app/
# (e.g. the tracing setup) to roll out a new image. Which runtime the platform
# actually uses is chosen in its Settings modal. Prompts for the AWS region
# (default us-east-1; or set AGENTCORE_REGION to skip the prompt).
#
# Usage:
#   ./init-agentcore-runtime.sh            # deploy (or redeploy)
#   ./init-agentcore-runtime.sh --destroy  # tear the runtime down in AWS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log()  { printf '\033[1;36m[init-agentcore-runtime]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[init-agentcore-runtime]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[init-agentcore-runtime]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

for cmd in npm npx agentcore python3 aws; do
  command -v "$cmd" >/dev/null 2>&1 || die "$cmd is required (agentcore CLI: npm install -g @aws/agentcore)"
done

ensure_env() {
  if [ ! -f .env ]; then
    log "No .env found — copying from .env.example"
    cp .env.example .env
    warn "Review .env and adjust TARGET_URL / BEDROCK_MODEL / etc. before your next run."
  fi
}

# set_env_var NAME VALUE — updates NAME=VALUE in .env in place, or appends it
# if the key isn't present yet. Used to auto-fill AGENTCORE_RUNTIME_ARN after
# a successful agentcore deploy, so you never have to copy an ARN out of
# terminal output by hand.
set_env_var() {
  local name="$1" value="$2"
  if grep -q "^${name}=" .env; then
    sed -i "s|^${name}=.*|${name}=${value}|" .env
  else
    printf '%s=%s\n' "$name" "$value" >> .env
  fi
}

# aws-targets.json is generated (gitignored — see agent-runtime-agentcore/agentcore/.gitignore)
# since it holds a real AWS account ID, which shouldn't be committed. Create
# or refresh it from whatever account the current AWS credentials resolve
# to, and from .env's BROWSER_REGION (the var that governs AgentCore
# Runtime/Browser region everywhere else in this project — see
# .env.example) — NOT the ambient AWS_REGION/AWS_DEFAULT_REGION env var,
# which the agentcore CLI falls back to on its own and can silently point a
# deploy at the wrong region if it differs from what .env says.
ensure_agentcore_account() {
  local agentcore_dir="$1"
  local targets_file="$agentcore_dir/aws-targets.json"

  local account region
  account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
  [ -z "$account" ] && { warn "Could not resolve AWS account via 'aws sts get-caller-identity' — leaving $targets_file as-is."; return 1; }
  region="$(grep -E '^BROWSER_REGION=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -z "$region" ] && region="ap-southeast-1"

  python3 -c "
import json, os
p = '$targets_file'
d = json.load(open(p)) if os.path.exists(p) else []
if not d:
    d = [{'name': 'default', 'description': 'Default target'}]
changed = False
for t in d:
    if t.get('account') != '$account':
        t['account'] = '$account'
        changed = True
    if t.get('region') != '$region':
        t['region'] = '$region'
        changed = True
if changed or not os.path.exists(p):
    json.dump(d, open(p, 'w'), indent=2)
    print('updated')
"
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
# resulting ARN into .env — matches the manual flow
# documented under "AgentCore Deployment" in the root README, just automated
# end-to-end. This is the only part of this script that touches real AWS
# infrastructure.
deploy_agentcore() {
  log "═══ AgentCore Runtime (AWS) ═══"
  local agentcore_dir="$SCRIPT_DIR/agent-runtime-agentcore/agentcore"
  [ -d "$agentcore_dir" ] || die "agent-runtime-agentcore/agentcore not found"

  ensure_env
  ensure_agentcore_account "$agentcore_dir"

  # cdk-stack.ts reads these at synth time to wire them into the runtime
  # container's environment — export so `npx agentcore deploy` below inherits
  # them (see that file's comment).
  export BEDROCK_MODEL="$(grep -E '^BEDROCK_MODEL=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
  export BEDROCK_REGION="$(grep -E '^BEDROCK_REGION=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
  export BROWSER_REGION="$(grep -E '^BROWSER_REGION=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"

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
  sync_platform_config agentcoreRuntimeArn "$arn"
  log "Wired AGENTCORE_RUNTIME_ARN into .env and the platform's config.json"
}

# Tears down the AgentCore Runtime deployed by deploy_agentcore, if any —
# the remove-then-redeploy flow documented by the agentcore CLI itself
# (agent-runtime-agentcore/agentcore/node_modules/@aws/agentcore's
# AGENTS.md): removing the runtime from agentcore.json and re-running
# `agentcore deploy` destroys the underlying CDK stack. agentcore.json is
# checked into git, so this restores it afterward — otherwise the working
# tree would end up dirty, and a future init-agentcore-runtime.sh run would have
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
  set_env_var AGENTCORE_RUNTIME_ARN ""
  sync_platform_config agentcoreRuntimeArn ""
  log "Cleared AGENTCORE_RUNTIME_ARN from .env and the platform's config.json"
}

# The orchestration platform reads .env (backend/src/loadEnv.js) but its saved
# settings in backend/src/state/config.json take priority over it, so updating
# .env alone would leave the app on the old region/ARN. Keep both in sync.
# sync_platform_config KEY VALUE — VALUE "" clears the key (stored as null).
sync_platform_config() {
  local file="$SCRIPT_DIR/backend/src/state/config.json"
  mkdir -p "$(dirname "$file")"
  python3 - "$file" "$1" "$2" <<'PY'
import json, os, sys
path, key, value = sys.argv[1:4]
d = json.load(open(path)) if os.path.exists(path) else {}
d[key] = value or None
json.dump(d, open(path, "w"), indent=2)
PY
}

# Reminder: the backend only reads .env/config.json at start-up.
remind_restart() {
  if curl -fs -m 2 http://localhost:4010/api/health >/dev/null 2>&1; then
    warn "The orchestration backend is running — restart it (Ctrl-C, then npm run dev) so it picks up the change."
  fi
}

# Asks which AWS region hosts the AgentCore Runtime + Browser (default
# us-east-1) and records it as BROWSER_REGION in .env — the single source the
# rest of this script (aws-targets.json, container env) and the platform read.
# Pre-set AGENTCORE_REGION to skip the prompt (e.g. in CI).
prompt_region() {
  local default="us-east-1" region="${AGENTCORE_REGION:-}"
  if [ -z "$region" ]; then
    if [ -t 0 ]; then
      read -r -p "AWS region for the AgentCore Runtime [${default}]: " region
    fi
    region="${region:-$default}"
  fi
  region="$(printf '%s' "$region" | tr -d '[:space:]')"
  [[ "$region" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] || die "'$region' doesn't look like an AWS region id (e.g. us-east-1)"
  ensure_env
  set_env_var BROWSER_REGION "$region"
  sync_platform_config browserRegion "$region"
  log "Using region: $region (saved to .env and the platform's config.json)"
}

case "${1:-}" in
  "")        prompt_region; deploy_agentcore; remind_restart ;;
  --destroy) prompt_region; destroy_agentcore; remind_restart ;;
  -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)         die "Unknown flag: $1 (see --help)" ;;
esac

log "Done."

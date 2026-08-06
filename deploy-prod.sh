#!/usr/bin/env bash
#
# Automates Mode 2 (prod) from the README — the full deploy documented in
# terraform/README.md:
#   1. terraform apply (creates ECR repos, VPC, EKS cluster + Fargate
#      profile, AWS Load Balancer Controller, CloudFront, IAM, S3, Cognito
#      user pool) for one or both stacks
#   2. docker build + push every image the stack needs
#   3. `kubectl rollout restart` so the Deployment picks up the pushed image
#      (Deployments here reference `:latest` — see the tfvars comments — so
#      a rollout restart is enough; no `terraform apply` needed to bump a
#      running image)
#
# This is NOT the Mode 1 (dev) flow — for a local Docker Compose stack on
# one host, see deploy-dev.sh instead. This script provisions real AWS
# infrastructure (EKS, ALB, CloudFront, ECR, Cognito, etc) and costs money
# while it's running.
#
# Two-phase apply is unavoidable: Terraform can create the ECR repo, but it
# can't build or push a Docker image into it. See terraform/README.md for
# the manual version of this same flow.
#
# The testrunner stack has an extra ordering wrinkle: its frontend image
# bakes Cognito config in at `docker build` time (Vite inlines
# import.meta.env.VITE_* into the JS bundle — see frontend/Dockerfile), so
# the frontend image can't be built until Cognito exists. This script
# handles that automatically — Cognito is created on the FIRST apply
# (along with the ECR repos), then the frontend build picks up its
# outputs before the image is pushed.
#
# Usage:
#   ./deploy-prod.sh testrunner              # deploy just the test runner
#   ./deploy-prod.sh sample-app              # deploy just the sample app
#   ./deploy-prod.sh all                     # deploy both (sample-app first,
#                                             # then testrunner's target_url is
#                                             # wired to sample-app's CloudFront
#                                             # URL automatically)
#   ./deploy-prod.sh testrunner --dry-run    # print the plan, do nothing
#   ./deploy-prod.sh testrunner --destroy    # tear down (terraform destroy)
#
# Env vars (all optional — see terraform/*/terraform.tfvars.example for the
# full set of app-config variables this does NOT try to manage; edit
# terraform.tfvars yourself for those):
#   AWS_REGION          default: us-east-1 (must match aws_region in tfvars)
#   SKIP_BUILD=1         reuse whatever image tag is already in ECR (skips
#                        docker build/push; still applies + force-deploys)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
REGION="${AWS_REGION:-us-east-1}"
DRY_RUN=0
DESTROY=0

log()  { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '  \033[2m$ %s\033[0m\n' "$*"
  else
    "$@"
  fi
}

# ── Preflight ────────────────────────────────────────────────────────────────

check_prereqs() {
  local missing=()
  command -v terraform >/dev/null 2>&1 || missing+=("terraform")
  command -v docker    >/dev/null 2>&1 || missing+=("docker")
  command -v aws       >/dev/null 2>&1 || missing+=("aws")
  command -v kubectl   >/dev/null 2>&1 || missing+=("kubectl")
  command -v python3   >/dev/null 2>&1 || missing+=("python3") # used to parse terraform -json output
  if [ ${#missing[@]} -gt 0 ]; then
    die "Missing required tools: ${missing[*]}"
  fi
  aws sts get-caller-identity >/dev/null 2>&1 \
    || die "AWS credentials not configured (aws sts get-caller-identity failed). Run 'aws configure' or assume a role first."
}

kubectl_for_stack() {
  # kubectl_for_stack <stack_dir> — points kubectl at the stack's EKS
  # cluster. Called before any kubectl command since each stack has its own
  # cluster (testrunner and sample-app are fully independent, per the
  # two-stacks-are-independent design).
  local stack_dir="$1" cluster
  cluster="$(tf_output "$stack_dir" eks_cluster_name)"
  [ -z "$cluster" ] && return 1
  aws eks update-kubeconfig --name "$cluster" --region "$REGION" >/dev/null
}

tf_output() {
  # tf_output <stack_dir> <output_name> — returns the raw string value, or
  # empty string if the output doesn't exist yet (first apply, before it's
  # been computed) rather than erroring the whole script.
  terraform -chdir="$1" output -raw "$2" 2>/dev/null || true
}

tf_output_json() {
  terraform -chdir="$1" output -json "$2" 2>/dev/null || echo '{}'
}

ecr_login() {
  local account_id
  account_id="$(aws sts get-caller-identity --query Account --output text)"
  log "Authenticating Docker against ECR ($account_id.dkr.ecr.$REGION.amazonaws.com)"
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$account_id.dkr.ecr.$REGION.amazonaws.com" >/dev/null
}

ensure_tfvars() {
  local stack_dir="$1"
  if [ ! -f "$stack_dir/terraform.tfvars" ]; then
    if [ -f "$stack_dir/terraform.tfvars.example" ]; then
      warn "$stack_dir/terraform.tfvars not found — copying from terraform.tfvars.example with defaults."
      warn "Review $stack_dir/terraform.tfvars and adjust before deploying again if the defaults aren't right."
      run cp "$stack_dir/terraform.tfvars.example" "$stack_dir/terraform.tfvars"
    else
      die "$stack_dir/terraform.tfvars.example missing — cannot bootstrap tfvars."
    fi
  fi
}

tf_apply() {
  local stack_dir="$1"; shift
  log "terraform init ($stack_dir)"
  run terraform -chdir="$stack_dir" init -input=false -upgrade=false
  log "terraform apply ($stack_dir)"
  if [ "$DRY_RUN" = "1" ]; then
    run terraform -chdir="$stack_dir" plan -input=false "$@"
  else
    terraform -chdir="$stack_dir" apply -input=false -auto-approve "$@"
  fi
}

tf_destroy() {
  local stack_dir="$1"
  log "terraform destroy ($stack_dir)"
  if [ "$DRY_RUN" = "1" ]; then
    run terraform -chdir="$stack_dir" plan -destroy -input=false
  else
    terraform -chdir="$stack_dir" destroy -input=false -auto-approve
  fi
}

# ── Testrunner ───────────────────────────────────────────────────────────────
#
# Phase 1: apply creates ECR repos + EKS cluster + Fargate profile + AWS Load
#          Balancer Controller + Cognito (if enabled) + everything else. The
#          Deployment's pods will exist but fail to start healthy until
#          phase 2 pushes real images.
# Phase 2: build + push backend, agent-runtime-local (no build-arg wrinkle),
#          then frontend (needs Cognito outputs from phase 1 as build-args).
# Phase 3: `kubectl rollout restart` so the Deployment picks up the newly
#          pushed :latest tags — Fargate pods don't auto-refresh on a plain
#          image push the way `docker compose up` would.

deploy_testrunner() {
  local stack_dir="$REPO_ROOT/terraform/testrunner"
  ensure_tfvars "$stack_dir"

  log "═══ Testrunner platform ═══"
  tf_apply "$stack_dir"
  [ "$DRY_RUN" = "1" ] && { log "(dry run — stopping before build/push)"; return; }

  if [ "${SKIP_BUILD:-0}" = "1" ]; then
    log "SKIP_BUILD=1 — reusing whatever image tag is already deployed"
  else
    ecr_login

    local repos backend_repo agent_repo frontend_repo
    repos="$(tf_output_json "$stack_dir" ecr_repository_urls)"
    backend_repo="$(echo "$repos" | python3 -c "import sys,json; print(json.load(sys.stdin)['backend'])")"
    agent_repo="$(echo "$repos"   | python3 -c "import sys,json; print(json.load(sys.stdin)['agent_runtime_local'])")"
    frontend_repo="$(echo "$repos" | python3 -c "import sys,json; print(json.load(sys.stdin)['frontend'])")"

    log "Building + pushing backend"
    # backend/ and frontend/ share one npm workspace rooted at the repo root
    # (see /package.json) — build context must be the repo root, not
    # backend/, so the Dockerfile can see the root package-lock.json.
    docker build -t "$backend_repo:latest" -f "$REPO_ROOT/backend/Dockerfile" "$REPO_ROOT"
    docker push "$backend_repo:latest"

    log "Building + pushing agent-runtime-local"
    docker build -t "$agent_repo:latest" "$REPO_ROOT/agent-runtime-local"
    docker push "$agent_repo:latest"

    # Frontend build-args come from Cognito outputs, which only exist after
    # phase 1's apply. Empty strings (auth disabled) are valid build-arg
    # values too — Dockerfile ARG defaults handle that already.
    local domain client_id pool_id
    domain="$(tf_output "$stack_dir" cognito_hosted_ui_domain)"
    client_id="$(tf_output "$stack_dir" cognito_client_id)"
    pool_id="$(tf_output "$stack_dir" cognito_user_pool_id)"

    if [ -n "$domain" ]; then
      log "Building frontend with Cognito auth baked in (pool: $pool_id)"
    else
      log "Building frontend with auth disabled (enable_cognito_auth = false, or Cognito not yet applied)"
    fi

    docker build \
      --build-arg "VITE_COGNITO_DOMAIN=$domain" \
      --build-arg "VITE_COGNITO_CLIENT_ID=$client_id" \
      --build-arg "VITE_COGNITO_USER_POOL_ID=$pool_id" \
      -t "$frontend_repo:latest" -f "$REPO_ROOT/frontend/Dockerfile" "$REPO_ROOT"
    docker push "$frontend_repo:latest"
  fi

  local namespace deployment
  namespace="$(tf_output "$stack_dir" k8s_namespace)"
  deployment="$(tf_output "$stack_dir" k8s_deployment_name)"
  if [ -n "$namespace" ] && [ -n "$deployment" ] && kubectl_for_stack "$stack_dir"; then
    log "Rolling out testrunner Deployment ($namespace/$deployment)"
    kubectl rollout restart "deployment/$deployment" -n "$namespace"
    kubectl rollout status  "deployment/$deployment" -n "$namespace" --timeout=180s
  fi

  log "Testrunner deployed."
  log "  URL:            $(tf_output "$stack_dir" cloudfront_url)"
  log "  ALB (fallback): $(tf_output "$stack_dir" alb_dns_name)"
  local pool_id_final; pool_id_final="$(tf_output "$stack_dir" cognito_user_pool_id)"
  if [ -n "$pool_id_final" ]; then
    log "  Cognito pool:   $pool_id_final"
    log "  First login: create a user with"
    log "    aws cognito-idp admin-create-user --user-pool-id $pool_id_final \\"
    log "      --username you@example.com --user-attributes Name=email,Value=you@example.com \\"
    log "      --temporary-password 'ChangeMe123!' --region $REGION"
    log "  (or set cognito_seed_users in terraform.tfvars before applying, next time)"
  fi
}

# ── Sample app ───────────────────────────────────────────────────────────────

deploy_sample_app() {
  local stack_dir="$REPO_ROOT/terraform/sample-app"
  ensure_tfvars "$stack_dir"

  log "═══ Sample app (CardDemo) ═══"
  tf_apply "$stack_dir"
  [ "$DRY_RUN" = "1" ] && { log "(dry run — stopping before build/push)"; return; }

  if [ "${SKIP_BUILD:-0}" = "1" ]; then
    log "SKIP_BUILD=1 — reusing whatever image tag is already deployed"
  else
    ecr_login

    local repos backend_repo frontend_repo
    repos="$(tf_output_json "$stack_dir" ecr_repository_urls)"
    backend_repo="$(echo "$repos"  | python3 -c "import sys,json; print(json.load(sys.stdin)['backend'])")"
    frontend_repo="$(echo "$repos" | python3 -c "import sys,json; print(json.load(sys.stdin)['frontend'])")"

    log "Building + pushing sample-app backend"
    docker build -t "$backend_repo:latest" "$REPO_ROOT/sample-app/backend"
    docker push "$backend_repo:latest"

    log "Building + pushing sample-app frontend"
    docker build -t "$frontend_repo:latest" "$REPO_ROOT/sample-app/frontend"
    docker push "$frontend_repo:latest"
  fi

  local namespace backend_deploy frontend_deploy
  namespace="$(tf_output "$stack_dir" k8s_namespace)"
  backend_deploy="$(tf_output "$stack_dir" backend_deployment_name)"
  frontend_deploy="$(tf_output "$stack_dir" frontend_deployment_name)"
  if [ -n "$namespace" ] && kubectl_for_stack "$stack_dir"; then
    if [ -n "$backend_deploy" ]; then
      log "Rolling out sample-app backend ($namespace/$backend_deploy)"
      kubectl rollout restart "deployment/$backend_deploy" -n "$namespace"
      kubectl rollout status  "deployment/$backend_deploy" -n "$namespace" --timeout=180s
    fi
    if [ -n "$frontend_deploy" ]; then
      log "Rolling out sample-app frontend ($namespace/$frontend_deploy)"
      kubectl rollout restart "deployment/$frontend_deploy" -n "$namespace"
      kubectl rollout status  "deployment/$frontend_deploy" -n "$namespace" --timeout=180s
    fi
  fi

  log "Sample app deployed."
  log "  URL: $(tf_output "$stack_dir" cloudfront_url)"
}

destroy_testrunner()  { tf_destroy "$REPO_ROOT/terraform/testrunner"; }
destroy_sample_app()  { tf_destroy "$REPO_ROOT/terraform/sample-app"; }

# ── main ─────────────────────────────────────────────────────────────────────

TARGET="${1:-}"
shift || true
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --destroy) DESTROY=1 ;;
    *) die "Unknown flag: $arg" ;;
  esac
done

[ -z "$TARGET" ] && die "Usage: $0 <testrunner|sample-app|all> [--dry-run|--destroy]"

check_prereqs

case "$TARGET" in
  testrunner)
    if [ "$DESTROY" = "1" ]; then destroy_testrunner; else deploy_testrunner; fi
    ;;
  sample-app)
    if [ "$DESTROY" = "1" ]; then destroy_sample_app; else deploy_sample_app; fi
    ;;
  all)
    if [ "$DESTROY" = "1" ]; then
      # Reverse order of creation, same reasoning as any stack teardown
      destroy_testrunner
      destroy_sample_app
    else
      deploy_sample_app
      # Wire the freshly-deployed sample-app's public URL into the
      # testrunner's target_url automatically, so `./deploy.sh all` produces
      # a working end-to-end demo with no manual tfvars edit in between.
      SAMPLE_APP_URL="$(tf_output "$REPO_ROOT/terraform/sample-app" cloudfront_url)"
      if [ -n "$SAMPLE_APP_URL" ] && [ "$DRY_RUN" != "1" ]; then
        log "Wiring testrunner target_url -> $SAMPLE_APP_URL"
        deploy_testrunner_target_url_override="-var=target_url=$SAMPLE_APP_URL"
        ensure_tfvars "$REPO_ROOT/terraform/testrunner"
        tf_apply "$REPO_ROOT/terraform/testrunner" "$deploy_testrunner_target_url_override" >/dev/null
      fi
      deploy_testrunner
    fi
    ;;
  *)
    die "Unknown target: $TARGET (expected testrunner, sample-app, or all)"
    ;;
esac

log "Done."

# Terraform — deploy this repo to your own AWS account

> This is sample code, for non-production usage. You should work with your
> security and legal teams to meet your organizational security, regulatory,
> and compliance requirements before deployment. This module provisions real
> AWS resources that cost money and are internet-reachable (EKS, ALB,
> CloudFront, Cognito) — review IAM policies, security group rules, and
> Cognito auth settings against your own requirements before running it
> against anything beyond a throwaway demo account. Licensed under
> [MIT-0](../LICENSE).

This is **Mode 2 (prod)** from the root README's Deployment Modes section —
a durable, publicly-reachable deployment. For local development, use
**Mode 1 (dev)**: `docker compose --profile local up --build` at the repo
root, no Terraform involved. Use this directory when you want the testrunner
and/or sample app reachable over the internet, backed by EKS instead of a
single Docker host.

This directory deploys the **containerized** parts of the repo to EKS
(Fargate profiles — no EC2 node groups to patch), behind an ALB provisioned
by the AWS Load Balancer Controller, behind CloudFront:

| Stack | Path | Deploys |
|---|---|---|
| Testrunner platform | `terraform/testrunner/` | `backend/`, `frontend/`, `agent-runtime-local/` — the Agentic Test Runner itself, behind Cognito auth |
| Sample app | `terraform/sample-app/` | `sample-app/backend/`, `sample-app/frontend/` — the CardDemo app under test, no auth |

**Not covered here:** `agent-runtime-agentcore/`. That component deploys to
AWS's AgentCore Runtime service (not EKS) via its own CDK app and `agentcore
deploy` CLI flow — see `agent-runtime-agentcore/agentcore/README.md`. If you
want `AGENT_MODE=agentcore` instead of `local`, deploy that separately first,
then point the testrunner stack's `agentcore_runtime_arn` variable at the
resulting ARN.

The two stacks here are fully independent — each gets its own EKS cluster,
VPC, ALB, and CloudFront distribution. Deploy one, both, or neither. Nothing
here is required for the other's `AGENT_MODE=local` path, and neither is
required for Mode 1 (local Docker Compose) development.

## Structure

```
terraform/
├── modules/
│   ├── vpc/          # 2-AZ VPC (public subnets always; private + NAT gateway when create_private_subnets = true)
│   ├── eks-cluster/  # EKS cluster (Fargate profile, OIDC provider for IRSA, ALB controller IAM role, Fargate logging)
│   ├── eks-addons/   # Kubernetes-side installs that need a live cluster: AWS Load Balancer Controller (Helm), Fargate logging ConfigMap
│   └── k8s-service/  # generic "Deployment + Service (+ Ingress)" building block — the EKS analog of an ECS "task + service"
├── testrunner/        # root config: ECR, EKS cluster, Cognito, S3, IAM, CloudFront
└── sample-app/        # root config: ECR, EKS cluster, IAM, (optional) EFS, CloudFront
```

`deploy-prod.sh` (repo root — see below) automates the full two-phase apply +
image build/push + rollout flow for both stacks.

Both root configs use the same shared modules, so the EKS/Ingress/CloudFront
patterns are consistent between them — only the container wiring differs.

## How the container topology maps to the source repo

**Testrunner (`terraform/testrunner/`):** `docker-compose.yml` runs backend,
frontend, and agent-runtime-local with `network_mode: host`, so they all talk
to each other over `localhost`. A Kubernetes pod's containers share one
network namespace — same effect. So this stack runs all three containers as
**one pod** (see `testrunner/k8s.tf`). `frontend/nginx.conf`'s
`proxy_pass http://127.0.0.1:4010` and the backend's default
`LOCAL_RUNTIME_URL=http://localhost:4020` both work unmodified. An `Ingress`
targets the frontend container on port 5175 (nginx), matching how nginx
already proxies `/api` and `/ws` to the backend; the AWS Load Balancer
Controller turns that `Ingress` into an ALB.

**Auth:** The testrunner UI + API sit behind Cognito (Authorization Code +
PKCE, enforced in the app — see `testrunner/cognito.tf` and
`backend/src/middleware/auth.js`), since this stack is meant to be a
long-lived, internet-reachable portal. Set `enable_cognito_auth = false` in
`terraform.tfvars` to turn it off. The sample app has no equivalent — it's
the target under test, not a portal.

**Sample app (`terraform/sample-app/`):** `sample-app/frontend/nginx.conf`
proxies to `http://backend:8021` — a Docker Compose service-name DNS lookup,
not `localhost`. Kubernetes gives you this natively via a `Service`: this
stack runs backend and frontend as two separate Deployments, with the
backend's `Service` explicitly named `backend` so nginx's `proxy_pass`
resolves it without any config changes.

**SQLite constraint:** `sample-app/backend` reads/writes a local SQLite file
(`spring.datasource.url=jdbc:sqlite:carddemo.db`). Fargate's ephemeral
storage means that file — and all CardDemo data — resets to the seeded
schema on every pod restart or redeploy. For this sample/demo deployment
that's an acceptable simplification (default: `enable_efs = false`). If you
want data to survive restarts, set `enable_efs = true` in
`sample-app/terraform.tfvars` to mount an EFS-backed PersistentVolume at the
backend's `/app` working directory instead (this also turns on the EFS CSI
driver EKS addon).

**Security groups:** Every ALB's ingress is restricted to CloudFront's
managed prefix list (`com.amazonaws.global.cloudfront.origin-facing`), not
`0.0.0.0/0` — direct-to-ALB requests from arbitrary internet hosts are
rejected at the security-group layer. Traffic reaching pods is scoped to
"from the ALB security group only" via a rule on the EKS cluster's primary
security group (see each stack's `sg.tf`).

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- `kubectl`, to check on/manage the cluster and trigger rollouts
- AWS credentials with permission to create VPC/EKS/ECR/ALB/CloudFront/IAM/S3/Cognito
  resources (e.g. via `aws configure` or an assumed role)
- Docker, to build and push the container images
- `aws` CLI, to authenticate Docker against ECR and generate kubeconfig (`aws eks update-kubeconfig`)

## Deploy flow

### Automated (recommended)

`deploy-prod.sh` lives at the repo root, alongside `deploy-local.sh` (Mode 1):

```bash
cd ..   # repo root, if you're not already there
./deploy-prod.sh testrunner              # deploy just the test runner
./deploy-prod.sh sample-app              # deploy just the sample app
./deploy-prod.sh all                     # deploy both — sample-app first, then
                                          # testrunner's target_url is wired to
                                          # sample-app's CloudFront URL automatically
./deploy-prod.sh testrunner --dry-run    # print the terraform plan, do nothing
./deploy-prod.sh testrunner --destroy    # tear down (terraform destroy)
```

`deploy-prod.sh` handles the two-phase apply (Terraform can create ECR repos
and the EKS cluster, but can't build/push Docker images), the Cognito
build-arg ordering wrinkle for the testrunner frontend (see below), and
`kubectl rollout restart` once new images are pushed. Copy each stack's
`terraform.tfvars.example` to `terraform.tfvars` first (or let `deploy-prod.sh`
do it for you with a warning) and adjust `aws_region`/`target_url`/etc.

### Manual

Terraform can't build Docker images — it can only create the ECR repos that
images get pushed to, and the EKS cluster + AWS Load Balancer Controller
that Deployments/Ingresses land on. So each stack is applied twice: once to
create the ECR repos/cluster, then again after pushing real images (a
`kubectl rollout restart` picks up a new `:latest` push without a second
`terraform apply`).

#### 1. Testrunner platform

```bash
cd terraform/testrunner
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: at minimum set aws_region, target_url,
# and (if you're not using the demo VPC) vpc_id / subnet_ids / private_subnet_ids

terraform init
terraform apply   # creates ECR repos, VPC, EKS cluster + Fargate profile,
                   # AWS Load Balancer Controller, IAM, S3, Cognito, CloudFront —
                   # but the Deployment's pods will fail to start healthy
                   # until images exist
```

Point `kubectl` at the new cluster, then build and push the three images
(run from the repo root; `REGION` must match `aws_region` in
`terraform/testrunner/terraform.tfvars`):

```bash
aws eks update-kubeconfig --name "$(terraform -chdir=terraform/testrunner output -raw eks_cluster_name)" --region us-east-1

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1   # match aws_region in terraform.tfvars
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

for svc in backend agent-runtime-local; do
  key=${svc//-/_}   # ecr_repository_urls map key uses underscores, e.g. agent_runtime_local
  repo=$(terraform -chdir=terraform/testrunner output -json ecr_repository_urls \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['$key'])")
  docker build -t "$repo:latest" "./$svc"
  docker push "$repo:latest"
done
```

The frontend needs one extra step: Vite bakes `VITE_COGNITO_*` into the JS
bundle at `docker build` time (not read at container runtime), so build it
with the Cognito outputs from the apply above as build-args:

```bash
FRONTEND_REPO=$(terraform -chdir=terraform/testrunner output -json ecr_repository_urls \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['frontend'])")

docker build \
  --build-arg "VITE_COGNITO_DOMAIN=$(terraform -chdir=terraform/testrunner output -raw cognito_hosted_ui_domain)" \
  --build-arg "VITE_COGNITO_CLIENT_ID=$(terraform -chdir=terraform/testrunner output -raw cognito_client_id)" \
  --build-arg "VITE_COGNITO_USER_POOL_ID=$(terraform -chdir=terraform/testrunner output -raw cognito_user_pool_id)" \
  -t "$FRONTEND_REPO:latest" ./frontend
docker push "$FRONTEND_REPO:latest"
```

Then roll out the Deployment so it picks up the pushed `:latest` tags:

```bash
kubectl rollout restart deployment/"$(terraform -chdir=terraform/testrunner output -raw k8s_deployment_name)" \
  -n "$(terraform -chdir=terraform/testrunner output -raw k8s_namespace)"
```

Create your first login (Cognito's `admin_create_user_config` disables
public self-signup):

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$(terraform -chdir=terraform/testrunner output -raw cognito_user_pool_id)" \
  --username you@example.com --user-attributes Name=email,Value=you@example.com \
  --temporary-password 'ChangeMe123!' --region "$REGION"
```

(Or set `cognito_seed_users` in `terraform.tfvars` before the first apply
instead, to skip this manual step next time.)

Get the public URL:

```bash
terraform -chdir=terraform/testrunner output cloudfront_url
```

CloudFront distributions take several minutes to reach `Deployed` status the
first time, and the AWS Load Balancer Controller takes a minute or two after
apply to actually provision the ALB behind the `Ingress` — if
`terraform apply` returns an empty `alb_dns_name`/`cloudfront_url` origin,
re-apply once the controller has caught up.

#### 2. Sample app (CardDemo)

Same two-phase pattern:

```bash
cd terraform/sample-app
cp terraform.tfvars.example terraform.tfvars
# edit as needed

terraform init
terraform apply

aws eks update-kubeconfig --name "$(terraform output -raw eks_cluster_name)" --region us-east-1

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1   # match aws_region in terraform.tfvars
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

for svc in backend frontend; do
  repo=$(terraform output -json ecr_repository_urls \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['$svc'])")
  docker build -t "$repo:latest" "../../sample-app/$svc"
  docker push "$repo:latest"
done

kubectl rollout restart deployment/"$(terraform output -raw backend_deployment_name)" -n "$(terraform output -raw k8s_namespace)"
kubectl rollout restart deployment/"$(terraform output -raw frontend_deployment_name)" -n "$(terraform output -raw k8s_namespace)"

terraform output cloudfront_url
```

If you deploy the sample app first, take its `cloudfront_url` output and set
it as `target_url` in `terraform/testrunner/terraform.tfvars` before applying
the testrunner stack (or change it later from the Test Runner's Settings UI
at runtime — see `backend/src/routes/config.js`).

## Variables of note

Both stacks accept `vpc_id` + `subnet_ids` (public, for the ALB) +
`private_subnet_ids` (for EKS/Fargate pods) to deploy into an existing VPC
instead of the demo VPC each stack creates by default (`modules/vpc/` — 2
public + 2 private subnets, one NAT gateway). See each stack's
`variables.tf` for the full list; `terraform.tfvars.example` covers the ones
you're most likely to change.

The testrunner stack's app-config variables (`target_url`, `agent_mode`,
`bedrock_model`, `bedrock_region`, `browser_region`, `agentcore_runtime_arn`)
mirror the env vars read by `backend/src/state/store.js` — see that file and
the repo-root `.env.example` for the authoritative list and defaults. Its
Cognito variables (`enable_cognito_auth`, `cognito_domain_prefix`,
`cognito_seed_users`) control the auth layer described above.

Pod sizing is per-container here (`backend_cpu`/`backend_memory`,
`frontend_cpu`/`frontend_memory`, etc — vCPU units and MiB, same units ECS
used), summed by EKS Fargate to size the pod, rather than one task-level
`cpu`/`memory` pair like the old ECS setup.

## Outputs

| Output | Stack | Description |
|---|---|---|
| `cloudfront_url` | both | Public HTTPS URL to open in a browser |
| `alb_dns_name` | both | ALB origin behind CloudFront, provisioned by the AWS Load Balancer Controller (may be empty right after the first apply — see above) |
| `ecr_repository_urls` | both | Push targets for `docker push` |
| `eks_cluster_name` | both | For `aws eks update-kubeconfig --name <this>` |
| `k8s_namespace` | both | Namespace the Deployment(s) run in |
| `k8s_deployment_name` | testrunner | Single combined Deployment name |
| `backend_deployment_name` / `frontend_deployment_name` | sample-app | Two separate Deployment names |
| `snapshot_bucket_name` | testrunner | S3 bucket for evidence screenshots |
| `cognito_user_pool_id` / `cognito_client_id` / `cognito_hosted_ui_domain` | testrunner | Null when `enable_cognito_auth = false` |

## Cleanup

```bash
./deploy-prod.sh testrunner --destroy    # from the repo root
./deploy-prod.sh sample-app --destroy
```

(or `terraform destroy` directly in each stack directory). ECR repos are
created with `force_delete = true` and the S3 snapshot bucket with
`force_destroy = true`, so `destroy` won't get stuck on leftover images or
objects.

## Cost note

EKS control plane pricing plus one NAT gateway per stack are the main fixed
costs this topology adds beyond the two ALBs, `PriceClass_100` CloudFront,
and small Fargate pod sizes — this is still the cheapest reasonable EKS
topology for a demo (Fargate profiles instead of an EC2 node group, no
Multi-AZ RDS, SQLite on local/EFS storage for the sample app). Running both
stacks continuously will cost real money — destroy the stacks when you're
done experimenting.

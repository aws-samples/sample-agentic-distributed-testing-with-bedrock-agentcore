variable "aws_region" {
  description = "AWS region to deploy the testrunner platform into."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name prefix applied to all resources in this stack."
  type        = string
  default     = "agentic-testrunner"
}

variable "environment" {
  description = "Free-text environment tag (e.g. demo, dev)."
  type        = string
  default     = "demo"
}

# ─── Networking ───────────────────────────────────────────────────────────────

variable "vpc_id" {
  description = "Existing VPC ID to deploy into. Leave null to have this stack create its own demo VPC (2 public subnets, no NAT)."
  type        = string
  default     = null
}

variable "subnet_ids" {
  description = "Existing public subnet IDs for the ALB the AWS Load Balancer Controller provisions. Required when vpc_id is set. Must span at least 2 AZs."
  type        = list(string)
  default     = []
}

variable "private_subnet_ids" {
  description = "Existing private subnet IDs for the EKS cluster and its Fargate pods. Required when vpc_id is set."
  type        = list(string)
  default     = []
}

variable "vpc_cidr_block" {
  description = "CIDR block used when this stack creates its own VPC (ignored if vpc_id is set)."
  type        = string
  default     = "10.42.0.0/16"
}

# ─── Container images ─────────────────────────────────────────────────────────
# Leave at defaults for the first `terraform apply` (which only needs to create
# the ECR repositories). After pushing real images, either re-apply with these
# variables pointing at your pushed tags, or just push the `latest` tag and
# leave the defaults — see terraform/README.md for the full two-phase flow.

variable "backend_image_tag" {
  description = "Tag of the backend image to deploy (image pushed to the backend ECR repo created by this stack)."
  type        = string
  default     = "latest"
}

variable "frontend_image_tag" {
  description = "Tag of the frontend image to deploy."
  type        = string
  default     = "latest"
}

variable "agent_runtime_local_image_tag" {
  description = "Tag of the agent-runtime-local image to deploy."
  type        = string
  default     = "latest"
}

# ─── Application configuration (mirrors docker-compose.yml / backend/src/state/store.js) ──

variable "target_url" {
  description = "URL of the application under test (TARGET_URL env var read by backend/src/state/store.js)."
  type        = string
  default     = "http://localhost:8020"
}

variable "agent_mode" {
  description = "Which runtime executes tests: 'agentcore' (AWS AgentCore Runtime, deployed separately via agent-runtime-agentcore/agentcore/) or 'local' (agent-runtime-local container, deployed by this stack)."
  type        = string
  default     = "agentcore"

  validation {
    condition     = contains(["local", "agentcore"], var.agent_mode)
    error_message = "agent_mode must be either \"local\" or \"agentcore\"."
  }
}

variable "bedrock_model" {
  description = "Bedrock model ID used for test-case generation and (in local mode) test execution."
  type        = string
  default     = "global.anthropic.claude-sonnet-4-6"
}

variable "bedrock_region" {
  description = "AWS region for Bedrock model inference calls."
  type        = string
  default     = "us-east-1"
}

variable "browser_region" {
  description = "AWS region for the AgentCore Browser / Runtime (only relevant when agent_mode = \"agentcore\")."
  type        = string
  default     = "us-east-1"
}

variable "agentcore_runtime_arn" {
  description = "ARN of an AgentCore Runtime deployed separately via agent-runtime-agentcore/agentcore/ (agentcore deploy). Only required when agent_mode = \"agentcore\". Leave blank for local mode."
  type        = string
  default     = ""
}

# ─── Sizing ────────────────────────────────────────────────────────────────────
# EKS Fargate sizes a pod from the sum of its containers' resource requests
# (see modules/k8s-service's cpu_request/memory_request), unlike ECS's
# task-level cpu/memory. Defaults below sum to the same 1024 vCPU-units /
# 3072 MiB the old combined ECS task used.

variable "backend_cpu" {
  description = "vCPU units (256 = 0.25 vCPU) requested for the backend container."
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "Memory (MiB) requested for the backend container."
  type        = number
  default     = 1536
}

variable "frontend_cpu" {
  description = "vCPU units requested for the frontend (nginx) container."
  type        = number
  default     = 256
}

variable "frontend_memory" {
  description = "Memory (MiB) requested for the frontend container."
  type        = number
  default     = 512
}

variable "agent_runtime_local_cpu" {
  description = "vCPU units requested for the agent-runtime-local container."
  type        = number
  default     = 256
}

variable "agent_runtime_local_memory" {
  description = "Memory (MiB) requested for the agent-runtime-local container."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of testrunner pod replicas to run."
  type        = number
  default     = 1
}

# ─── Snapshot storage ──────────────────────────────────────────────────────────

variable "snapshot_bucket_name" {
  description = "Name for the S3 bucket that stores evidence screenshots (backend/src/services/snapshots.js). Leave blank to have this stack generate a unique name."
  type        = string
  default     = ""
}

variable "snapshot_retention_days" {
  description = "Days after which evidence snapshots expire via S3 lifecycle rule."
  type        = number
  default     = 30
}

# ─── CloudFront / access ───────────────────────────────────────────────────────

variable "cloudfront_price_class" {
  description = "CloudFront price class (PriceClass_All, PriceClass_200, PriceClass_100)."
  type        = string
  default     = "PriceClass_100"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention (days) for all service log groups."
  type        = number
  default     = 14
}

variable "tags" {
  description = "Additional tags applied to all resources."
  type        = map(string)
  default     = {}
}

# ─── Auth (Cognito) ─────────────────────────────────────────────────────────────
# Applies to the testrunner portal + its API only. The sample-app stack has no
# equivalent — it's the demo target under test, not something meant to sit
# behind a login screen.

variable "enable_cognito_auth" {
  description = "Require a Cognito-authenticated session for the testrunner UI and API. When true, the frontend redirects unauthenticated visitors to the Cognito Hosted UI, and the backend rejects /api/* requests without a valid access token — see cognito.tf and backend/src/middleware/auth.js."
  type        = bool
  default     = true
}

variable "cognito_domain_prefix" {
  description = "Domain prefix for the Cognito Hosted UI (must be globally unique across all AWS accounts). Leave blank to auto-generate one from project_name + account ID."
  type        = string
  default     = ""
}

variable "cognito_seed_users" {
  description = "Optional list of users to create in the pool at apply time (admin_create_user_config disables self-signup, so this is the bootstrap path for your first login). Each user must set a real password via the Hosted UI on first login. Leave empty to create users out-of-band via `aws cognito-idp admin-create-user` instead."
  type = list(object({
    email              = string
    temporary_password = string
  }))
  default   = []
  sensitive = true
}

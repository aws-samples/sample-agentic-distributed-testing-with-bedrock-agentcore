variable "aws_region" {
  description = "AWS region to deploy the CardDemo sample app into."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name prefix applied to all resources in this stack."
  type        = string
  default     = "carddemo"
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
  default     = "10.43.0.0/16"
}

# ─── Container images ─────────────────────────────────────────────────────────

variable "backend_image_tag" {
  description = "Tag of the sample-app backend (Spring Boot) image to deploy."
  type        = string
  default     = "latest"
}

variable "frontend_image_tag" {
  description = "Tag of the sample-app frontend (nginx) image to deploy."
  type        = string
  default     = "latest"
}

# ─── Sizing ────────────────────────────────────────────────────────────────────

variable "backend_cpu" {
  description = "Fargate vCPU units for the Spring Boot backend task."
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "Fargate memory (MiB) for the Spring Boot backend task."
  type        = number
  default     = 1024
}

variable "frontend_cpu" {
  description = "Fargate vCPU units for the nginx frontend task."
  type        = number
  default     = 256
}

variable "frontend_memory" {
  description = "Fargate memory (MiB) for the nginx frontend task."
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Number of tasks to run per service."
  type        = number
  default     = 1
}

# ─── Persistence ───────────────────────────────────────────────────────────────
# sample-app/backend uses SQLite on local disk (spring.datasource.url=jdbc:sqlite:carddemo.db,
# see sample-app/backend/src/main/resources/application.properties). Fargate
# task storage is ephemeral, so without EFS, data resets to the seeded schema
# on every task restart/redeploy. That's an intentional simplification for
# this demo stack — see terraform/README.md. Set enable_efs = true for
# durable storage across restarts.
variable "enable_efs" {
  description = "Mount an EFS-backed volume for the SQLite database file so data survives task restarts. When false (default), the demo resets to seed data on every restart — the simplest option for a sample app."
  type        = bool
  default     = false
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

variable "name" {
  description = "Name for the EKS cluster and related resources."
  type        = string
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version."
  type        = string
  default     = "1.31"
}

variable "vpc_id" {
  description = "VPC ID to create the cluster in."
  type        = string
}

# EKS control plane ENIs go in these. For a Fargate-only cluster (no EC2
# node groups), pods run in whichever subnets the Fargate profile's
# selectors point at — private_subnet_ids below, not these.
variable "control_plane_subnet_ids" {
  description = "Subnet IDs for the EKS control plane's cross-account ENIs. Must span at least 2 AZs. Public or private both work; this repo passes the same private subnets used for pods."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs where Fargate pods actually run (via the Fargate profile's subnet selection)."
  type        = list(string)
}

variable "app_namespace" {
  description = "Kubernetes namespace the default Fargate profile's second selector covers, in addition to kube-system. The caller creates this namespace (e.g. via kubernetes_namespace) and deploys workloads into it."
  type        = string
  default     = "default"
}

variable "enable_efs_csi_driver" {
  description = "Install the aws-efs-csi-driver EKS addon + its IRSA role. Only needed by stacks that mount EFS-backed PersistentVolumes (e.g. sample-app's optional SQLite-persistence volume). Off by default since most workloads here don't need it."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the cluster-wide Fargate log group (see fargate-logging.tf). Fargate pods have no host to `docker logs` into, so container stdout/stderr only exists in CloudWatch once Fargate Logging is configured — see modules/eks-addons' aws-observability ConfigMap, which points at this log group."
  type        = number
  default     = 14
}

variable "public_subnet_ids" {
  description = "Public subnet IDs — used only so the AWS Load Balancer Controller can provision an internet-facing ALB with a target in each AZ."
  type        = list(string)
}

variable "endpoint_public_access" {
  description = "Whether the EKS API server endpoint is reachable from the public internet. Kept true by default so `kubectl`/`terraform apply` from a laptop or CI runner (not inside the VPC) can reach it without a bastion/VPN — this is a demo repo, not a locked-down production cluster."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to all resources created by this module."
  type        = map(string)
  default     = {}
}

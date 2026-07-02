variable "cluster_name" {
  description = "EKS cluster name (from modules/eks-cluster's cluster_name output)."
  type        = string
}

variable "aws_region" {
  description = "AWS region the cluster runs in — passed to the controller as --aws-region."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID the cluster runs in — passed to the controller as --aws-vpc-id, since it can't always reliably auto-discover this on a Fargate-only cluster with no EC2 instance metadata to introspect."
  type        = string
}

variable "alb_controller_role_arn" {
  description = "IRSA role ARN for the controller's ServiceAccount (modules/eks-cluster's alb_controller_role_arn output)."
  type        = string
}

variable "fargate_log_group_name" {
  description = "CloudWatch Logs group name Fargate should route pod stdout/stderr to (modules/eks-cluster's fargate_log_group_name output)."
  type        = string
}

variable "chart_version" {
  description = "aws-load-balancer-controller Helm chart version (from https://aws.github.io/eks-charts)."
  type        = string
  default     = "3.4.0"
}

variable "tags" {
  description = "Tags applied to resources this module creates directly (the chart's own AWS resources are tagged by the controller itself, not Terraform)."
  type        = map(string)
  default     = {}
}

output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded cluster CA cert, needed to build a kubeconfig."
  value       = aws_eks_cluster.this.certificate_authority[0].data
}

output "cluster_arn" {
  value = aws_eks_cluster.this.arn
}

output "oidc_provider_arn" {
  description = "ARN of the IAM OIDC provider — reference this in any IRSA role's assume-role trust policy (e.g. the AWS Load Balancer Controller's role, or a per-workload app role)."
  value       = aws_iam_openid_connect_provider.cluster.arn
}

output "oidc_provider_url" {
  description = "Issuer URL (no https:// prefix stripped) of the cluster's OIDC provider — used to build the trust-policy StringEquals condition key for IRSA roles."
  value       = aws_eks_cluster.this.identity[0].oidc[0].issuer
}

output "fargate_profile_name" {
  value = aws_eks_fargate_profile.default.fargate_profile_name
}

output "fargate_pod_execution_role_arn" {
  value = aws_iam_role.fargate_pod_execution.arn
}

output "cluster_security_group_id" {
  description = "The cluster's primary security group (created implicitly by EKS) — used to scope ingress from the ALB Ingress Controller's target-group health checks."
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}

output "alb_controller_role_arn" {
  description = "IRSA role ARN for the AWS Load Balancer Controller's Kubernetes ServiceAccount (kube-system:aws-load-balancer-controller). Pass to modules/eks-addons' helm_release."
  value       = aws_iam_role.alb_controller.arn
}

output "fargate_log_group_name" {
  description = "CloudWatch Logs group Fargate pod stdout/stderr is routed to, once modules/eks-addons' aws-observability ConfigMap is applied."
  value       = aws_cloudwatch_log_group.fargate.name
}

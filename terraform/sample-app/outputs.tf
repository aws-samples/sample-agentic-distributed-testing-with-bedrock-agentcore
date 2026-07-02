output "cloudfront_url" {
  description = "Public URL for the CardDemo sample app."
  value       = "https://${aws_cloudfront_distribution.sample_app.domain_name}"
}

output "alb_dns_name" {
  description = "DNS name of the ALB the AWS Load Balancer Controller provisioned for the frontend Ingress (origin behind CloudFront). May be empty immediately after the first apply — see the comment in cloudfront.tf."
  value       = module.frontend_service.ingress_hostname
}

output "ecr_repository_urls" {
  description = "ECR repository URLs to push the backend/frontend images to."
  value       = { for k, v in aws_ecr_repository.this : k => v.repository_url }
}

output "eks_cluster_name" {
  description = "Name of the EKS cluster. Feed to `aws eks update-kubeconfig --name <this>` before any kubectl command."
  value       = module.eks_cluster.cluster_name
}

output "k8s_namespace" {
  description = "Kubernetes namespace the backend/frontend Deployments run in."
  value       = local.app_namespace
}

output "backend_deployment_name" {
  description = "Name of the backend Deployment. Feed to `kubectl rollout restart deployment/<this> -n <k8s_namespace>` to redeploy after pushing a new image."
  value       = module.backend_service.deployment_name
}

output "frontend_deployment_name" {
  description = "Name of the frontend Deployment."
  value       = module.frontend_service.deployment_name
}

output "vpc_id" {
  description = "VPC ID used by this stack (created or supplied)."
  value       = local.vpc_id
}

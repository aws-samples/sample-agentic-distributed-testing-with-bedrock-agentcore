output "cloudfront_url" {
  description = "Public URL for the Agentic Test Runner UI."
  value       = "https://${aws_cloudfront_distribution.testrunner.domain_name}"
}

output "alb_dns_name" {
  description = "DNS name of the ALB the AWS Load Balancer Controller provisioned for the testrunner Ingress (origin behind CloudFront). May be empty immediately after the first apply — see the comment in cloudfront.tf."
  value       = module.testrunner_service.ingress_hostname
}

output "ecr_repository_urls" {
  description = "ECR repository URLs to push the backend/frontend/agent-runtime-local images to."
  value       = { for k, v in aws_ecr_repository.this : k => v.repository_url }
}

output "eks_cluster_name" {
  description = "Name of the EKS cluster. Feed to `aws eks update-kubeconfig --name <this>` before any kubectl command."
  value       = module.eks_cluster.cluster_name
}

output "k8s_namespace" {
  description = "Kubernetes namespace the testrunner Deployment runs in."
  value       = local.app_namespace
}

output "k8s_deployment_name" {
  description = "Name of the testrunner Deployment. Feed to `kubectl rollout restart deployment/<this> -n <k8s_namespace>` to redeploy after pushing new images."
  value       = module.testrunner_service.deployment_name
}

output "snapshot_bucket_name" {
  description = "S3 bucket storing evidence snapshots."
  value       = aws_s3_bucket.snapshots.bucket
}

output "vpc_id" {
  description = "VPC ID used by this stack (created or supplied)."
  value       = local.vpc_id
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID. Feed to backend as COGNITO_USER_POOL_ID (backend/src/middleware/auth.js) and to the frontend build as VITE_COGNITO_USER_POOL_ID. Null when enable_cognito_auth = false."
  value       = var.enable_cognito_auth ? aws_cognito_user_pool.testrunner[0].id : null
}

output "cognito_client_id" {
  description = "Cognito App Client ID (public SPA client, no secret). Feed to the frontend build as VITE_COGNITO_CLIENT_ID. Null when enable_cognito_auth = false."
  value       = var.enable_cognito_auth ? aws_cognito_user_pool_client.testrunner[0].id : null
}

output "cognito_hosted_ui_domain" {
  description = "Cognito Hosted UI domain, e.g. https://<prefix>.auth.<region>.amazoncognito.com. Feed to the frontend build as VITE_COGNITO_DOMAIN. Null when enable_cognito_auth = false."
  value       = var.enable_cognito_auth ? "https://${aws_cognito_user_pool_domain.testrunner[0].domain}.auth.${local.region}.amazoncognito.com" : null
}

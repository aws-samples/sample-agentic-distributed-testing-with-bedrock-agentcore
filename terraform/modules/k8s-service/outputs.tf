output "deployment_name" {
  value = kubernetes_deployment_v1.this.metadata[0].name
}

output "service_dns_name" {
  description = "In-cluster DNS name other pods in the same namespace can reach this service at (just the short name also works within the same namespace; this is the fully-qualified form). Null if neither create_service nor enable_ingress is set."
  value       = local.needs_service ? "${kubernetes_service_v1.this[0].metadata[0].name}.${var.namespace}.svc.cluster.local" : null
}

output "ingress_hostname" {
  description = "ALB DNS hostname the AWS Load Balancer Controller provisions for this Ingress, once it reconciles (may be empty briefly right after apply — retry `terraform apply`/refresh if empty). Null if enable_ingress is false."
  value       = var.enable_ingress ? try(kubernetes_ingress_v1.this[0].status[0].load_balancer[0].ingress[0].hostname, "") : null
}

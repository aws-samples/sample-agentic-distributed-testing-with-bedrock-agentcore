output "controller_service_account" {
  description = "Kubernetes ServiceAccount name the controller runs as (kube-system namespace) — Ingress resources don't reference this directly, but it's useful for `kubectl describe`/debugging."
  value       = "aws-load-balancer-controller"
}

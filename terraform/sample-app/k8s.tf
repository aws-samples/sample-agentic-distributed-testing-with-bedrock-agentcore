module "backend_service" {
  source = "../modules/k8s-service"

  name_prefix          = "${local.name_prefix}-backend"
  namespace            = kubernetes_namespace_v1.app.metadata[0].name
  service_account_name = kubernetes_service_account_v1.sample_app.metadata[0].name
  replicas             = var.desired_count
  tags                 = local.common_tags

  # No Ingress — the backend is only reachable from the frontend service,
  # over the in-cluster Service DNS below (matching how
  # sample-app/docker-compose.yml never publishes the backend's 8021 port
  # publicly either).
  enable_ingress = false

  # Gives the pod the stable DNS name "backend" within the carddemo
  # namespace, so the frontend's nginx.conf (`proxy_pass http://backend:8021;`)
  # resolves it exactly as it did via Docker Compose's built-in service-name
  # DNS — no nginx.conf changes needed. service_name overrides the Service's
  # metadata.name to "backend" instead of this module call's full
  # "${local.name_prefix}-backend" name_prefix.
  create_service                = true
  service_name                  = "backend"
  service_port                  = 8021
  service_target_container_port = 8021

  containers = [
    {
      name           = "backend"
      image          = "${aws_ecr_repository.this["backend"].repository_url}:${var.backend_image_tag}"
      port           = 8021
      cpu_request    = var.backend_cpu
      memory_request = var.backend_memory
      environment    = {}
      volume_mounts = var.enable_efs ? [{
        name       = "carddemo-db"
        mount_path = "/app"
      }] : []
    },
  ]

  # SQLite file lives at /app/carddemo.db (working dir set by
  # sample-app/backend/Dockerfile). Mounting the EFS-backed PVC at /app makes
  # the db file persist across pod restarts/redeploys — the k8s-native
  # equivalent of ecs-service's efs_volumes.
  volumes = var.enable_efs ? [{
    name                         = "carddemo-db"
    persistent_volume_claim_name = kubernetes_persistent_volume_claim_v1.carddemo_db[0].metadata[0].name
  }] : []

  depends_on = [aws_ecr_repository.this]
}

module "frontend_service" {
  source = "../modules/k8s-service"

  name_prefix          = "${local.name_prefix}-frontend"
  namespace            = kubernetes_namespace_v1.app.metadata[0].name
  service_account_name = kubernetes_service_account_v1.sample_app.metadata[0].name
  replicas             = var.desired_count
  tags                 = local.common_tags

  # Publishes nothing under a discovery name — nothing needs to reach the
  # frontend by in-cluster DNS, only the Ingress below.
  create_service = false

  enable_ingress                = true
  ingress_health_check_path     = "/"
  alb_subnet_ids                = local.public_subnet_ids
  alb_security_group_ids        = [aws_security_group.alb.id]
  service_port                  = 80
  service_target_container_port = 80

  containers = [
    {
      name           = "frontend"
      image          = "${aws_ecr_repository.this["frontend"].repository_url}:${var.frontend_image_tag}"
      port           = 80
      cpu_request    = var.frontend_cpu
      memory_request = var.frontend_memory
      environment    = {}
    },
  ]

  depends_on = [
    aws_ecr_repository.this,
    module.eks_addons,
    module.backend_service,
  ]
}

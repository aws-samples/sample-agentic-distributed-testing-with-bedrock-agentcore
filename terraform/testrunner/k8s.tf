locals {
  agentcore_arn_effective = var.agent_mode == "agentcore" ? var.agentcore_runtime_arn : ""
}

module "testrunner_service" {
  source = "../modules/k8s-service"

  name_prefix          = local.name_prefix
  namespace            = kubernetes_namespace_v1.app.metadata[0].name
  service_account_name = kubernetes_service_account_v1.testrunner.metadata[0].name
  replicas             = var.desired_count
  tags                 = local.common_tags

  create_service                = true
  service_port                  = 5175
  service_target_container_port = 5175

  enable_ingress            = true
  ingress_health_check_path = "/api/health"
  alb_subnet_ids            = local.public_subnet_ids
  alb_security_group_ids    = [aws_security_group.alb.id]

  # All three containers below run in a single pod. A pod's containers
  # share one network namespace — the same effect ECS's awsvpc mode gave
  # the equivalent single-task deployment — so frontend/nginx.conf's
  # `proxy_pass http://127.0.0.1:4010` and backend's default
  # `LOCAL_RUNTIME_URL=http://localhost:4020` work with zero code changes.
  containers = [
    {
      name           = "backend"
      image          = "${aws_ecr_repository.this["backend"].repository_url}:${var.backend_image_tag}"
      port           = 4010
      cpu_request    = var.backend_cpu
      memory_request = var.backend_memory
      environment = {
        PORT                  = "4010"
        TARGET_URL            = var.target_url
        BEDROCK_MODEL         = var.bedrock_model
        BEDROCK_REGION        = var.bedrock_region
        BROWSER_REGION        = var.browser_region
        AGENTCORE_RUNTIME_ARN = local.agentcore_arn_effective
        AGENT_MODE            = var.agent_mode
        LOCAL_RUNTIME_URL     = "http://localhost:4020"
        S3_SNAPSHOT_BUCKET    = aws_s3_bucket.snapshots.bucket
        S3_SNAPSHOT_REGION    = local.region
        # Read at request time (not build time, unlike the frontend's VITE_*
        # vars) by backend/src/middleware/auth.js. Empty strings when
        # enable_cognito_auth = false — that's what keeps requireAuth() a
        # no-op passthrough for local/dev-style deployments.
        COGNITO_USER_POOL_ID = var.enable_cognito_auth ? aws_cognito_user_pool.testrunner[0].id : ""
        COGNITO_CLIENT_ID    = var.enable_cognito_auth ? aws_cognito_user_pool_client.testrunner[0].id : ""
      }
    },
    {
      name           = "frontend"
      image          = "${aws_ecr_repository.this["frontend"].repository_url}:${var.frontend_image_tag}"
      port           = 5175
      cpu_request    = var.frontend_cpu
      memory_request = var.frontend_memory
      environment    = {}
    },
    {
      name           = "agent-runtime-local"
      image          = "${aws_ecr_repository.this["agent_runtime_local"].repository_url}:${var.agent_runtime_local_image_tag}"
      port           = 4020
      cpu_request    = var.agent_runtime_local_cpu
      memory_request = var.agent_runtime_local_memory
      environment = {
        PORT           = "4020"
        BEDROCK_REGION = var.bedrock_region
        BEDROCK_MODEL  = var.bedrock_model
      }
    },
  ]

  depends_on = [
    aws_ecr_repository.this,
    module.eks_addons,
  ]
}

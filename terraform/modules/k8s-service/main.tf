/**
 * Deployment + Service (+ optional Ingress) — the EKS-on-Fargate analog of
 * modules/ecs-service's "task + service (+ ALB target + Service Connect)".
 * One call = one pod spec (which may hold multiple containers, mirroring
 * how the testrunner ECS task bundles backend+frontend+agent-runtime-local
 * into a single task for shared-localhost networking — a Kubernetes pod's
 * network namespace gives the same effect).
 */

locals {
  labels = {
    app = var.name_prefix
  }

  # An Ingress's backend always targets a Service — force one into existence
  # even if the caller left create_service at its default without thinking
  # about the Ingress case, rather than producing a dangling reference.
  needs_service = var.create_service || var.enable_ingress
  service_name  = var.service_name != "" ? var.service_name : var.name_prefix
}

resource "kubernetes_deployment_v1" "this" {
  metadata {
    name      = var.name_prefix
    namespace = var.namespace
    labels    = local.labels
  }

  spec {
    replicas = var.replicas

    selector {
      match_labels = local.labels
    }

    template {
      metadata {
        labels = local.labels
      }

      spec {
        service_account_name = var.service_account_name != "" ? var.service_account_name : null

        dynamic "container" {
          for_each = var.containers
          content {
            name    = container.value.name
            image   = container.value.image
            command = container.value.command

            dynamic "port" {
              for_each = container.value.port != null ? [container.value.port] : []
              content {
                container_port = port.value
              }
            }

            dynamic "env" {
              for_each = container.value.environment
              content {
                name  = env.key
                value = env.value
              }
            }

            resources {
              requests = {
                cpu    = "${container.value.cpu_request}m"
                memory = "${container.value.memory_request}Mi"
              }
              limits = {
                cpu    = "${container.value.cpu_request}m"
                memory = "${container.value.memory_request}Mi"
              }
            }

            dynamic "volume_mount" {
              for_each = container.value.volume_mounts
              content {
                name       = volume_mount.value.name
                mount_path = volume_mount.value.mount_path
              }
            }
          }
        }

        dynamic "volume" {
          for_each = var.volumes
          content {
            name = volume.value.name
            persistent_volume_claim {
              claim_name = volume.value.persistent_volume_claim_name
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "this" {
  count = local.needs_service ? 1 : 0

  metadata {
    name      = local.service_name
    namespace = var.namespace
    labels    = local.labels
  }

  spec {
    selector = local.labels
    type     = "ClusterIP"

    port {
      port        = var.service_port
      target_port = var.service_target_container_port
    }
  }
}

# ALB Ingress — only created for the one service per stack meant to receive
# external traffic. Annotations drive the AWS Load Balancer Controller
# (modules/eks-addons); target-type "ip" is required on Fargate since pods
# have no EC2 instance to register as a target.
resource "kubernetes_ingress_v1" "this" {
  count = var.enable_ingress ? 1 : 0

  metadata {
    name      = var.name_prefix
    namespace = var.namespace
    labels    = local.labels

    annotations = merge(
      {
        "kubernetes.io/ingress.class"                = "alb"
        "alb.ingress.kubernetes.io/scheme"           = var.alb_scheme
        "alb.ingress.kubernetes.io/target-type"      = "ip"
        "alb.ingress.kubernetes.io/healthcheck-path" = var.ingress_health_check_path
        "alb.ingress.kubernetes.io/listen-ports"     = jsonencode([{ HTTP = 80 }])
        "alb.ingress.kubernetes.io/subnets"          = join(",", var.alb_subnet_ids)
      },
      length(var.alb_security_group_ids) > 0 ? {
        "alb.ingress.kubernetes.io/security-groups" = join(",", var.alb_security_group_ids)
        # Without this, the controller layers its own auto-created SG (open
        # ingress) on top of the ones listed above — defeating the
        # CloudFront-only restriction this repo's sg.tf sets up.
        "alb.ingress.kubernetes.io/manage-backend-security-group-rules" = "false"
      } : {},
      var.ingress_group_name != null ? {
        "alb.ingress.kubernetes.io/group.name" = var.ingress_group_name
      } : {},
      length(var.tags) > 0 ? {
        "alb.ingress.kubernetes.io/tags" = join(",", [for k, v in var.tags : "${k}=${v}"])
      } : {},
    )
  }

  spec {
    rule {
      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service_v1.this[0].metadata[0].name
              port {
                number = var.service_port
              }
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_service_v1.this]
}

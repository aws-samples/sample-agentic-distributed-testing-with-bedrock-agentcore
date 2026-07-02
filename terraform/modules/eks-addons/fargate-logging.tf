/**
 * Fargate Logging: a well-known ConfigMap (kube-system/aws-observability)
 * that EKS's built-in Fluent Bit log router reads to decide where pod
 * stdout/stderr goes. The log group + IAM permissions to write to it are
 * created in modules/eks-cluster (aws provider only); this ConfigMap is the
 * missing piece that actually turns the routing on, and needs the
 * kubernetes provider configured against the live cluster.
 */

resource "kubernetes_namespace_v1" "aws_observability" {
  metadata {
    name = "aws-observability"
    labels = {
      "aws-observability" = "enabled"
    }
  }
}

resource "kubernetes_config_map_v1" "aws_logging" {
  metadata {
    name      = "aws-logging"
    namespace = kubernetes_namespace_v1.aws_observability.metadata[0].name
  }

  data = {
    "flb_log_cw"   = "true"
    "filters.conf" = <<-EOT
      [FILTER]
          Name parser
          Match *
          Key_name log
          Parser crio
    EOT
    "output.conf"  = <<-EOT
      [OUTPUT]
          Name cloudwatch_logs
          Match *
          region ${var.aws_region}
          log_group_name ${var.fargate_log_group_name}
          log_stream_prefix fargate/
          auto_create_group false
    EOT
  }
}

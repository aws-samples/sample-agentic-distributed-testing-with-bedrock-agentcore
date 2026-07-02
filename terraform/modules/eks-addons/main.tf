/**
 * AWS Load Balancer Controller install. This is what turns a Kubernetes
 * `Ingress` resource (see modules/k8s-service) into an actual ALB — the
 * EKS-on-Fargate equivalent of what modules/ecs-service's `aws_lb_listener`
 * + `aws_lb_target_group` did directly via Terraform on the ECS stacks.
 *
 * The chart creates its own ServiceAccount (kube-system/aws-load-balancer-controller)
 * annotated with the IRSA role ARN below, so pods get AWS credentials via
 * the EKS Pod Identity webhook without any static keys.
 */

resource "helm_release" "aws_load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = var.chart_version
  namespace  = "kube-system"

  set {
    name  = "clusterName"
    value = var.cluster_name
  }

  set {
    name  = "region"
    value = var.aws_region
  }

  set {
    name  = "vpcId"
    value = var.vpc_id
  }

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }

  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = var.alb_controller_role_arn
  }

  set {
    # Fargate-only cluster: the controller pod itself must also run on
    # Fargate, not wait for a node group that doesn't exist.
    name  = "replicaCount"
    value = "1"
  }
}

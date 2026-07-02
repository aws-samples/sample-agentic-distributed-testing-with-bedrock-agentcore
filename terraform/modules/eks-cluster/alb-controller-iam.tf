/**
 * IRSA (IAM Role for Service Account) for the AWS Load Balancer Controller.
 * Only the IAM side lives in this module — it only needs the `aws` provider,
 * which this module already has. The actual Kubernetes-side install (the
 * ServiceAccount + Deployment via the `aws-load-balancer-controller` Helm
 * chart) needs the `kubernetes`/`helm` providers configured against this
 * exact cluster's endpoint — that configuration can only happen in the root
 * module (a module can't configure a provider from resources it just
 * created itself), so it lives in modules/eks-addons instead. Root stacks
 * wire this role's ARN into that module.
 */

data "aws_iam_policy_document" "alb_controller_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.cluster.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(aws_eks_cluster.this.identity[0].oidc[0].issuer, "https://", "")}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(aws_eks_cluster.this.identity[0].oidc[0].issuer, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "alb_controller" {
  name               = "${var.name}-alb-controller"
  assume_role_policy = data.aws_iam_policy_document.alb_controller_assume_role.json
  tags               = var.tags
}

# Upstream policy JSON, vendored verbatim from
# https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/main/docs/install/iam_policy.json
# — the permissions the controller needs to create/manage ALBs, target
# groups, listeners, and security groups on behalf of Ingress resources.
resource "aws_iam_policy" "alb_controller" {
  name   = "${var.name}-alb-controller-policy"
  policy = file("${path.module}/files/alb_controller_iam_policy.json")
  tags   = var.tags
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  role       = aws_iam_role.alb_controller.name
  policy_arn = aws_iam_policy.alb_controller.arn
}

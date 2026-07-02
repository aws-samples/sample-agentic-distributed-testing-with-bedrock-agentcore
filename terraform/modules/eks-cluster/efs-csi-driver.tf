/**
 * Optional EFS CSI driver, for stacks that need a PersistentVolume backed by
 * EFS (the EKS equivalent of ecs-service's efs_volumes mechanism — see
 * sample-app's enable_efs variable). Gated behind var.enable_efs_csi_driver
 * so stacks that don't need durable storage don't pay for/run it.
 */

data "aws_iam_policy_document" "efs_csi_assume_role" {
  count = var.enable_efs_csi_driver ? 1 : 0

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
      values   = ["system:serviceaccount:kube-system:efs-csi-controller-sa"]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(aws_eks_cluster.this.identity[0].oidc[0].issuer, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "efs_csi" {
  count = var.enable_efs_csi_driver ? 1 : 0

  name               = "${var.name}-efs-csi"
  assume_role_policy = data.aws_iam_policy_document.efs_csi_assume_role[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "efs_csi" {
  count = var.enable_efs_csi_driver ? 1 : 0

  role       = aws_iam_role.efs_csi[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonEFSCSIDriverPolicy"
}

resource "aws_eks_addon" "efs_csi_driver" {
  count = var.enable_efs_csi_driver ? 1 : 0

  cluster_name             = aws_eks_cluster.this.name
  addon_name               = "aws-efs-csi-driver"
  service_account_role_arn = aws_iam_role.efs_csi[0].arn

  depends_on = [aws_eks_fargate_profile.default]
}

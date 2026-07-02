/**
 * Fargate-only EKS cluster: no EC2 node groups, no worker-node patching. All
 * pods run on AWS-managed Fargate compute via one or more Fargate profiles
 * (this module creates a default one covering kube-system + a caller-chosen
 * app namespace; callers can add more with aws_eks_fargate_profile
 * resources of their own if they need per-namespace CPU/memory isolation).
 *
 * Also provisions the IAM OIDC provider EKS needs for IRSA (IAM Roles for
 * Service Accounts) — required by the AWS Load Balancer Controller
 * (terraform/modules/eks-cluster/alb-controller.tf) and by any app pod that
 * needs to call AWS APIs (Bedrock, S3, AgentCore) with its own scoped
 * permissions instead of a shared node role — there ARE no nodes here to
 * share a role from.
 */

data "aws_partition" "current" {}

# ─── Cluster IAM role ───────────────────────────────────────────────────────────

data "aws_iam_policy_document" "cluster_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${var.name}-cluster-role"
  assume_role_policy = data.aws_iam_policy_document.cluster_assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "cluster_policy" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSClusterPolicy"
}

# ─── Cluster ─────────────────────────────────────────────────────────────────

resource "aws_eks_cluster" "this" {
  name     = var.name
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  vpc_config {
    subnet_ids              = var.control_plane_subnet_ids
    endpoint_public_access  = var.endpoint_public_access
    endpoint_private_access = true
  }

  access_config {
    authentication_mode = "API" # modern IAM-to-Kubernetes-RBAC mapping, no aws-auth ConfigMap to hand-edit
  }

  tags = var.tags

  depends_on = [aws_iam_role_policy_attachment.cluster_policy]
}

# Grant the identity running `terraform apply` cluster-admin via an EKS
# access entry — needed because access_config.authentication_mode = "API"
# means the cluster creator is NOT automatically granted access the way the
# older aws-auth ConfigMap model implicitly did.
data "aws_caller_identity" "current" {}

resource "aws_eks_access_entry" "apply_identity" {
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = data.aws_caller_identity.current.arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "apply_identity_admin" {
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = data.aws_caller_identity.current.arn
  policy_arn    = "arn:${data.aws_partition.current.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.apply_identity]
}

# ─── OIDC provider (IRSA) ───────────────────────────────────────────────────────

data "tls_certificate" "cluster" {
  url = aws_eks_cluster.this.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "cluster" {
  url             = aws_eks_cluster.this.identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.cluster.certificates[0].sha1_fingerprint]

  tags = var.tags
}

# ─── Fargate pod execution role ─────────────────────────────────────────────────
# One role, shared by every Fargate profile in this module. Scoped only to
# what Fargate itself needs to run a pod (pull from ECR, write CloudWatch
# Logs) — NOT app-level permissions (Bedrock/S3/AgentCore). Those are
# granted per-workload via IRSA service-account roles instead (see
# terraform/testrunner-eks/iam.tf), so a compromised pod can't reach AWS
# APIs the app itself was never granted.

data "aws_iam_policy_document" "fargate_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks-fargate-pods.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fargate_pod_execution" {
  name               = "${var.name}-fargate-pod-exec"
  assume_role_policy = data.aws_iam_policy_document.fargate_assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "fargate_pod_execution" {
  role       = aws_iam_role.fargate_pod_execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSFargatePodExecutionRolePolicy"
}

# ─── Default Fargate profile ────────────────────────────────────────────────────
# Covers kube-system (CoreDNS must run on Fargate too, since there are no EC2
# nodes for it) plus one caller-supplied app namespace. Add more
# aws_eks_fargate_profile resources at the call site for additional
# namespaces if needed — each profile is billed independently, this default
# one is enough for a single-app demo deployment.

resource "aws_eks_fargate_profile" "default" {
  cluster_name           = aws_eks_cluster.this.name
  fargate_profile_name   = "${var.name}-default"
  pod_execution_role_arn = aws_iam_role.fargate_pod_execution.arn
  subnet_ids             = var.private_subnet_ids

  selector {
    namespace = "kube-system"
  }

  selector {
    namespace = var.app_namespace
  }

  tags = var.tags

  depends_on = [aws_eks_cluster.this]
}

# CoreDNS ships as an EKS add-on that defaults to expecting EC2 nodes
# (nodeSelector on kubernetes.io/os: linux without a Fargate-compatible
# scheduling profile in some EKS versions). Patching its compute type to
# Fargate here avoids CoreDNS pods sitting Pending forever on a
# node-group-less cluster.
resource "aws_eks_addon" "coredns" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "coredns"

  configuration_values = jsonencode({
    computeType = "Fargate"
  })

  depends_on = [aws_eks_fargate_profile.default]
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "kube-proxy"
}

resource "aws_eks_addon" "vpc_cni" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "vpc-cni"
}

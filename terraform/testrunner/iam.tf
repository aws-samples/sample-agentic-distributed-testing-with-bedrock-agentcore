/**
 * IRSA role for the testrunner pod's ServiceAccount — the EKS equivalent of
 * ECS's task_role_arn (app-level AWS permissions: Bedrock, AgentCore, S3).
 * There's no equivalent of ECS's execution_role_arn here: image pulls and
 * CloudWatch Logs writes on Fargate are covered by
 * modules/eks-cluster's shared fargate_pod_execution_role, not a per-app role.
 */

resource "kubernetes_service_account_v1" "testrunner" {
  metadata {
    name      = "${local.name_prefix}-sa"
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.task.arn
    }
  }
}

data "aws_iam_policy_document" "task_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [module.eks_cluster.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(module.eks_cluster.oidc_provider_url, "https://", "")}:sub"
      values   = ["system:serviceaccount:${local.app_namespace}:${local.name_prefix}-sa"]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(module.eks_cluster.oidc_provider_url, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-task-role"
  assume_role_policy = data.aws_iam_policy_document.task_assume_role.json
  tags               = local.common_tags
}

# Bedrock model inference — backend/src/routes/generate.js and
# backend/src/routes/config.js (health check) call Converse/ConverseStream
# against whatever model the user selects, across whatever region they pick
# in Settings, so we scope to the model family rather than a single model ID.
data "aws_iam_policy_document" "task_bedrock" {
  statement {
    sid    = "BedrockInvoke"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:Converse",
      "bedrock:ConverseStream",
    ]
    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:*:${local.account_id}:inference-profile/*",
    ]
  }
}

# AgentCore Runtime invocation — only exercised when AGENT_MODE=agentcore
# (backend/src/services/runner.js). Harmless to grant even in local mode
# since it's scoped to this account/region's agentcore runtimes.
data "aws_iam_policy_document" "task_agentcore" {
  statement {
    sid    = "AgentCoreInvoke"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:InvokeAgentRuntime",
    ]
    resources = [
      "arn:aws:bedrock-agentcore:*:${local.account_id}:runtime/*",
    ]
  }
}

# Evidence snapshot bucket — backend/src/services/snapshots.js does
# PutObject/GetObject/DeleteObjects under runs/<runId>/<tcId>/*.
data "aws_iam_policy_document" "task_s3_snapshots" {
  statement {
    sid    = "SnapshotObjectAccess"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.snapshots.arn}/*"]
  }

  statement {
    sid       = "SnapshotBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.snapshots.arn]
  }
}

data "aws_iam_policy_document" "task_combined" {
  source_policy_documents = [
    data.aws_iam_policy_document.task_bedrock.json,
    data.aws_iam_policy_document.task_agentcore.json,
    data.aws_iam_policy_document.task_s3_snapshots.json,
  ]
}

resource "aws_iam_role_policy" "task_inline" {
  name   = "${local.name_prefix}-task-policy"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_combined.json
}

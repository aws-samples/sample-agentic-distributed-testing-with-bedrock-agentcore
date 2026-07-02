/**
 * Fargate pods have no EC2 host to `docker logs` into — container
 * stdout/stderr only reaches CloudWatch once "Fargate Logging" is enabled,
 * which is a `kube-system` ConfigMap (aws-observability) pointing at a log
 * group, not a plain EKS API setting. The ConfigMap itself needs the
 * `kubernetes` provider (configured against this cluster), so it's created
 * by modules/eks-addons — this module only creates the log group + the IAM
 * permissions the Fargate log router needs to write to it, both pure `aws`
 * provider resources.
 */

resource "aws_cloudwatch_log_group" "fargate" {
  name              = "/eks/${var.name}/fargate"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "aws_iam_policy_document" "fargate_logging" {
  statement {
    sid    = "FargateLogRouterWrite"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:CreateLogGroup",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = ["${aws_cloudwatch_log_group.fargate.arn}:*"]
  }
}

resource "aws_iam_role_policy" "fargate_logging" {
  name   = "${var.name}-fargate-logging"
  role   = aws_iam_role.fargate_pod_execution.name
  policy = data.aws_iam_policy_document.fargate_logging.json
}

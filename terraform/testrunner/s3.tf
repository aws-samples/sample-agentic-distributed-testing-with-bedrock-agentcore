resource "aws_s3_bucket" "snapshots" {
  bucket        = local.snapshot_bucket_name
  force_destroy = true

  tags = local.common_tags
}

resource "aws_s3_bucket_versioning" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# backend/src/services/snapshots.js note: "Lifecycle policy on the bucket
# should expire objects after ~30 days" — implemented here, configurable via
# var.snapshot_retention_days.
resource "aws_s3_bucket_lifecycle_configuration" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id

  rule {
    id     = "expire-old-snapshots"
    status = "Enabled"

    filter {
      prefix = "runs/"
    }

    expiration {
      days = var.snapshot_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.snapshot_retention_days
    }
  }
}

# Bucket is private (no public access); the ECS task role is granted
# PutObject/GetObject/DeleteObject via the IAM policy in iam.tf. This bucket
# policy additionally denies any non-TLS access, matching AWS's recommended
# baseline for S3 buckets holding evidence data.
data "aws_iam_policy_document" "snapshots_bucket_policy" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.snapshots.arn, "${aws_s3_bucket.snapshots.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "AllowTaskRoleObjectAccess"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.task.arn]
    }
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.snapshots.arn}/*"]
  }

  statement {
    sid    = "AllowTaskRoleBucketList"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.task.arn]
    }
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.snapshots.arn]
  }
}

resource "aws_s3_bucket_policy" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  policy = data.aws_iam_policy_document.snapshots_bucket_policy.json
}

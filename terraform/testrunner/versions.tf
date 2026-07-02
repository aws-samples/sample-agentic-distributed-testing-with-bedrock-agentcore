terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# CloudFront requires ACM certs (not used here, we rely on the default
# *.cloudfront.net domain) to live in us-east-1, but since we don't attach a
# custom ACM cert we don't need an aliased provider. Kept as a comment for
# anyone adding a custom domain later:
#
# provider "aws" {
#   alias  = "us_east_1"
#   region = "us-east-1"
# }

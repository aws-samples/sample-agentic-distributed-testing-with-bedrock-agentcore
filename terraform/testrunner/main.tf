data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# AWS-managed prefix list of CloudFront's edge-location IP ranges. Used to
# scope the ALB security group's ingress rule to CloudFront only, instead of
# 0.0.0.0/0 — see sg.tf.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

locals {
  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Stack       = "testrunner"
    },
    var.tags
  )

  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name

  use_own_vpc = var.vpc_id == null
  vpc_id      = local.use_own_vpc ? module.vpc[0].vpc_id : var.vpc_id
  # EKS Fargate pods run in private subnets (no public IP needed/wanted);
  # the ALB the AWS Load Balancer Controller provisions for the Ingress
  # still goes in the public subnets, same as the ECS stacks' aws_lb did.
  public_subnet_ids  = local.use_own_vpc ? module.vpc[0].public_subnet_ids : var.subnet_ids
  private_subnet_ids = local.use_own_vpc ? module.vpc[0].private_subnet_ids : var.private_subnet_ids

  snapshot_bucket_name = var.snapshot_bucket_name != "" ? var.snapshot_bucket_name : "${var.project_name}-snapshots-${local.account_id}-${local.region}"

  name_prefix   = "${var.project_name}-${var.environment}"
  app_namespace = "testrunner"
}

module "vpc" {
  count  = local.use_own_vpc ? 1 : 0
  source = "../modules/vpc"

  name                   = local.name_prefix
  cidr_block             = var.vpc_cidr_block
  az_count               = 2
  create_private_subnets = true
  tags                   = local.common_tags
}

module "eks_cluster" {
  source = "../modules/eks-cluster"

  name                     = "${local.name_prefix}-eks"
  vpc_id                   = local.vpc_id
  control_plane_subnet_ids = local.private_subnet_ids
  private_subnet_ids       = local.private_subnet_ids
  public_subnet_ids        = local.public_subnet_ids
  app_namespace            = local.app_namespace
  log_retention_days       = var.log_retention_days
  tags                     = local.common_tags
}

provider "kubernetes" {
  host                   = module.eks_cluster.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks_cluster.cluster_certificate_authority_data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks_cluster.cluster_name, "--region", local.region]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks_cluster.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks_cluster.cluster_certificate_authority_data)

    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks_cluster.cluster_name, "--region", local.region]
    }
  }
}

module "eks_addons" {
  source = "../modules/eks-addons"

  cluster_name            = module.eks_cluster.cluster_name
  aws_region              = local.region
  vpc_id                  = local.vpc_id
  alb_controller_role_arn = module.eks_cluster.alb_controller_role_arn
  fargate_log_group_name  = module.eks_cluster.fargate_log_group_name
  tags                    = local.common_tags
}

resource "kubernetes_namespace_v1" "app" {
  metadata {
    name = local.app_namespace
  }

  depends_on = [module.eks_cluster]
}

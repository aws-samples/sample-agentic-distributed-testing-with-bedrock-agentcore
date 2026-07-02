resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Allows inbound HTTP from CloudFront to the sample-app ALB"
  vpc_id      = local.vpc_id

  # Restrict to CloudFront's own edge IP ranges (AWS-managed prefix list)
  # instead of 0.0.0.0/0, so the ALB only accepts traffic that has actually
  # gone through the distribution in front of it — direct-to-ALB requests
  # from arbitrary internet hosts are rejected at the security-group layer.
  ingress {
    description     = "HTTP from CloudFront edge locations only"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# Fargate pods (both frontend and backend) get an ENI in the EKS cluster's
# primary security group unless a SecurityGroupPolicy says otherwise — this
# stack doesn't define one. Frontend-to-backend traffic (nginx's
# `proxy_pass http://backend:8021`) and ALB-to-frontend traffic therefore
# both need intra-cluster-SG rules, since everything shares this one SG —
# the k8s-on-Fargate equivalent of the ECS stack's separate alb/frontend/backend
# security groups.
resource "aws_security_group_rule" "pods_from_alb" {
  type                     = "ingress"
  description              = "HTTP from ALB to sample-app frontend pods (nginx on 80)"
  security_group_id        = module.eks_cluster.cluster_security_group_id
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "pods_self" {
  type              = "ingress"
  description       = "Frontend pod to backend pod (nginx proxy_pass http://backend:8021) and any other intra-cluster pod traffic"
  security_group_id = module.eks_cluster.cluster_security_group_id
  from_port         = 0
  to_port           = 65535
  protocol          = "tcp"
  self              = true
}

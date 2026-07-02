/**
 * VPC for a demo deployment. Always creates public subnets — used for the
 * ALB the AWS Load Balancer Controller provisions for each stack's Ingress.
 * Optionally also creates private subnets + a NAT gateway
 * (create_private_subnets), used for the EKS cluster itself and its
 * Fargate pods: pods must not be directly internet-routable, so they run in
 * private subnets and reach ECR/Bedrock/S3 via NAT instead.
 */

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(var.tags, { Name = "${var.name}-vpc" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = merge(var.tags, { Name = "${var.name}-igw" })
}

resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${var.name}-public-${count.index}"
    # EKS's aws-load-balancer-controller auto-discovers subnets for
    # internet-facing ALBs/NLBs via this tag when the Ingress/Service
    # doesn't hardcode subnet IDs.
    "kubernetes.io/role/elb" = "1"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(var.tags, { Name = "${var.name}-public-rt" })
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ─── Private subnets + NAT (EKS only) ──────────────────────────────────────────

resource "aws_subnet" "private" {
  count             = var.create_private_subnets ? var.az_count : 0
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr_block, 8, var.az_count + count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = merge(var.tags, {
    Name = "${var.name}-private-${count.index}"
    # aws-load-balancer-controller subnet auto-discovery for internal
    # ALBs/NLBs, and required by EKS itself for private-subnet worker/pod ENIs.
    "kubernetes.io/role/internal-elb" = "1"
  })
}

resource "aws_eip" "nat" {
  count  = var.create_private_subnets ? 1 : 0
  domain = "vpc"

  tags = merge(var.tags, { Name = "${var.name}-nat-eip" })
}

# Single NAT gateway (not one per AZ) — cheaper for a demo; the tradeoff is
# all private-subnet egress funnels through one AZ. Fine for this repo's
# traffic volume; split into per-AZ NAT gateways for a production workload.
resource "aws_nat_gateway" "this" {
  count         = var.create_private_subnets ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id

  tags = merge(var.tags, { Name = "${var.name}-nat" })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "private" {
  count  = var.create_private_subnets ? 1 : 0
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[0].id
  }

  tags = merge(var.tags, { Name = "${var.name}-private-rt" })
}

resource "aws_route_table_association" "private" {
  count          = var.create_private_subnets ? var.az_count : 0
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

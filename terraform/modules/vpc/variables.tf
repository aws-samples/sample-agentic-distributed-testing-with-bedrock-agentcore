variable "name" {
  description = "Name prefix for VPC resources."
  type        = string
}

variable "cidr_block" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to spread public (and, if enabled, private) subnets across. 2 is the minimum for an ALB or an EKS cluster."
  type        = number
  default     = 2
}

variable "create_private_subnets" {
  description = "Also create private subnets + a single NAT gateway. Required for both stacks' EKS clusters — Fargate pods run in private subnets, not directly internet-routable. Left optional (default false) since some other caller of this module might not need an EKS-style topology."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to all resources created by this module."
  type        = map(string)
  default     = {}
}

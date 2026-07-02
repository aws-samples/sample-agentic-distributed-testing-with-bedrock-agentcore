output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Empty list when create_private_subnets = false."
  value       = aws_subnet.private[*].id
}

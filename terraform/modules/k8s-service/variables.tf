variable "name_prefix" {
  description = "Prefix used for the Deployment, Service, and (if enabled) Ingress names."
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace to deploy into. Must be covered by a Fargate profile selector (see modules/eks-cluster's app_namespace)."
  type        = string
}

variable "service_account_name" {
  description = "Kubernetes ServiceAccount the pod runs as. Leave blank to use the namespace's default account (no AWS permissions). Set to an IRSA-annotated ServiceAccount's name to grant the pod scoped AWS API access (Bedrock, S3, AgentCore, etc) — the ECS equivalent of ecs-service's task_role_arn."
  type        = string
  default     = ""
}

variable "replicas" {
  description = "Number of pod replicas."
  type        = number
  default     = 1
}

variable "containers" {
  description = <<-EOT
    List of container definitions for this pod. Each entry:
      name        - container name
      image       - full ECR image URI including tag
      port        - container port to expose (optional; omit for containers with no listening port)
      environment - map of plain-text environment variables
      command     - optional command override (list of strings)
      cpu_request - vCPU units in the ECS sense (256 = 0.25 vCPU); summed across containers to size the Fargate pod
      memory_request - MiB; summed across containers to size the Fargate pod
    EOT
  type = list(object({
    name           = string
    image          = string
    port           = optional(number)
    environment    = optional(map(string), {})
    command        = optional(list(string))
    cpu_request    = optional(number, 256)
    memory_request = optional(number, 512)
    volume_mounts = optional(list(object({
      name       = string # must match a key in var.volumes
      mount_path = string
    })), [])
  }))
}

variable "volumes" {
  description = "Pod-level volumes, referenced by name from a container's volume_mounts. Currently supports PersistentVolumeClaim-backed volumes only (e.g. an EFS-backed PVC) — the k8s-native equivalent of ecs-service's efs_volumes."
  type = list(object({
    name                  = string
    persistent_volume_claim_name = string
  }))
  default = []
}

variable "service_port" {
  description = "Port the in-cluster Service listens on and forwards to. Required if create_service is true. This is what gives the pod a stable DNS name (name_prefix.namespace.svc.cluster.local, or just name_prefix from within the same namespace) — the k8s-native equivalent of ECS Service Connect's discovery name."
  type        = number
  default     = null
}

variable "service_target_container_port" {
  description = "Container port the Service forwards to. Required if create_service is true."
  type        = number
  default     = null
}

variable "create_service" {
  description = "Whether to create a ClusterIP Service for in-cluster DNS discovery (other pods reach this one at http://<service_name>.<namespace>.svc.cluster.local:<service_port>). Set false for services that are never called by another in-cluster pod. Forced on regardless when enable_ingress is true, since an Ingress backend always targets a Service."
  type        = bool
  default     = true
}

variable "service_name" {
  description = "Name of the Kubernetes Service (and Ingress, if enabled). Defaults to name_prefix. Override when another in-cluster pod expects a specific discovery name baked into its own config (e.g. sample-app's nginx.conf hardcodes `proxy_pass http://backend:8021`, so that service must be named exactly \"backend\" regardless of this stack's name_prefix)."
  type        = string
  default     = ""
}

variable "enable_ingress" {
  description = "Whether to create an Ingress (provisions an ALB via the AWS Load Balancer Controller — see modules/eks-addons). Only one service per stack typically needs this: the one meant to receive external traffic."
  type        = bool
  default     = false
}

variable "ingress_group_name" {
  description = "IngressGroup name (alb.ingress.kubernetes.io/group.name). Ingresses sharing a group name share one ALB instead of provisioning one each — set the same value across every Ingress in a stack that should sit behind a single load balancer."
  type        = string
  default     = null
}

variable "ingress_health_check_path" {
  description = "Path the ALB target group health-checks against."
  type        = string
  default     = "/"
}

variable "alb_scheme" {
  description = "internet-facing or internal. internet-facing since CloudFront needs to reach the ALB over the public internet as its origin (same topology as the ECS stacks' aws_lb)."
  type        = string
  default     = "internet-facing"
}

variable "alb_security_group_ids" {
  description = "Additional security group IDs to attach to the ALB the controller provisions (e.g. the CloudFront-only ingress rule from sg.tf). If empty, the controller auto-creates one open to 0.0.0.0/0 on the listener port — always pass an explicit SG here to keep the CloudFront-only restriction."
  type        = list(string)
  default     = []
}

variable "alb_subnet_ids" {
  description = "Public subnet IDs the ALB is provisioned into. Required when enable_ingress is true."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to the ALB (via annotation) and propagated to pod labels where useful."
  type        = map(string)
  default     = {}
}

/**
 * Origin is the ALB the AWS Load Balancer Controller provisions from
 * module.testrunner_service's Ingress — not a Terraform-managed aws_lb like
 * the ECS predecessor had. The controller only creates that ALB after the
 * Ingress reconciles, so ingress_hostname can come back empty on the very
 * first apply; re-apply (or `terraform apply -target=module.testrunner_service`
 * then a full apply) once the ALB exists if this distribution ends up
 * pointed at an empty origin domain.
 */
resource "aws_cloudfront_distribution" "testrunner" {
  enabled         = true
  comment         = "${local.name_prefix} — Agentic Test Runner UI"
  price_class     = var.cloudfront_price_class
  is_ipv6_enabled = true

  origin {
    domain_name = module.testrunner_service.ingress_hostname
    origin_id   = "testrunner-alb"

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "testrunner-alb"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # The app is a dynamic SPA + API + WebSocket, not static assets — disable
    # caching so API responses / WS upgrades always reach the origin.
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = local.common_tags
}

# AWS-managed policies — avoids reinventing cache/header-forwarding behavior.
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewerExceptHostHeader"
}

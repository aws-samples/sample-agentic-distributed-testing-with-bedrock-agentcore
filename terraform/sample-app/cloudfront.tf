/**
 * Origin is the ALB the AWS Load Balancer Controller provisions from
 * module.frontend_service's Ingress — not a Terraform-managed aws_lb like
 * the ECS predecessor had. The controller only creates that ALB after the
 * Ingress reconciles, so ingress_hostname can come back empty on the very
 * first apply; re-apply once the ALB exists if this distribution ends up
 * pointed at an empty origin domain.
 */
resource "aws_cloudfront_distribution" "sample_app" {
  enabled         = true
  comment         = "${local.name_prefix} — CardDemo sample app"
  price_class     = var.cloudfront_price_class
  is_ipv6_enabled = true

  origin {
    domain_name = module.frontend_service.ingress_hostname
    origin_id   = "sample-app-alb"

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
    target_origin_id       = "sample-app-alb"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # CardDemo is a dynamic SPA + REST API (sample-app/frontend/nginx.conf
    # proxies /api/ to Spring Boot), so caching is disabled to keep API
    # responses fresh.
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

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewerExceptHostHeader"
}

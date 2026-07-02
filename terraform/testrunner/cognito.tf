/**
 * Cognito-backed auth in front of the Agentic Test Runner UI + API.
 *
 * Enforced at the application layer, not the ALB listener:
 *   - Frontend: unauthenticated visitors are redirected to the Cognito
 *     Hosted UI (Authorization Code + PKCE flow — no client secret, safe for
 *     a browser-only SPA); on return, the SPA holds the ID/access tokens
 *     and attaches the access token as a Bearer header on every /api/* call.
 *   - Backend: an Express middleware verifies the incoming JWT against this
 *     user pool's JWKS before any /api/* route runs — see
 *     backend/src/middleware/auth.js and its wiring in backend/src/index.js.
 *
 * Why not ALB-native `authenticate-cognito`: that feature requires an HTTPS
 * listener with a CA-trusted certificate, which requires a custom domain.
 * This stack intentionally has neither — it relies on CloudFront's default
 * *.cloudfront.net certificate to stay zero-config. Doing the verification
 * in the app avoids that dependency and works identically whether the
 * request came through CloudFront, hit the ALB directly, or arrived over
 * WebSocket.
 *
 * Sample-app is intentionally excluded — it's the demo target the test
 * runner drives, not a portal, and is not meant to require login.
 */

resource "aws_cognito_user_pool" "testrunner" {
  count = var.enable_cognito_auth ? 1 : 0
  name  = "${local.name_prefix}-users"

  # Admins create accounts (no public self-registration) — appropriate for
  # an internal test-automation portal, not a public-signup product.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  auto_verified_attributes = ["email"]

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = local.common_tags
}

# Cognito's Hosted UI requires a globally-unique domain prefix. Defaults to
# name_prefix + account ID suffix so it doesn't collide across accounts/demos
# without the user having to pick one.
resource "aws_cognito_user_pool_domain" "testrunner" {
  count        = var.enable_cognito_auth ? 1 : 0
  domain       = var.cognito_domain_prefix != "" ? var.cognito_domain_prefix : "${local.name_prefix}-${local.account_id}"
  user_pool_id = aws_cognito_user_pool.testrunner[0].id
}

# Public client (no secret) for the SPA's Authorization Code + PKCE flow.
# A confidential client (generate_secret = true) is the wrong shape here:
# the secret would have to ship inside the browser bundle to be usable
# client-side, defeating the point of having one.
resource "aws_cognito_user_pool_client" "testrunner" {
  count        = var.enable_cognito_auth ? 1 : 0
  name         = "${local.name_prefix}-spa-client"
  user_pool_id = aws_cognito_user_pool.testrunner[0].id

  generate_secret = false

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  prevent_user_existence_errors        = "ENABLED"

  supported_identity_providers = ["COGNITO"]

  callback_urls = [
    "https://${aws_cloudfront_distribution.testrunner.domain_name}/",
    "http://localhost:5175/", # local dev against a deployed pool
  ]
  logout_urls = [
    "https://${aws_cloudfront_distribution.testrunner.domain_name}/",
    "http://localhost:5175/",
  ]

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

# ─── Seed users ────────────────────────────────────────────────────────────────
# Optional convenience: create initial Cognito users straight from Terraform
# instead of requiring a separate `aws cognito-idp admin-create-user` call.
# Each seeded user gets FORCE_CHANGE_PASSWORD status — they set a real
# password on first Hosted UI login. Leave `cognito_seed_users` empty (the
# default) to skip this and create users out-of-band instead.
resource "aws_cognito_user" "seed" {
  for_each = var.enable_cognito_auth ? { for u in var.cognito_seed_users : u.email => u } : {}

  user_pool_id       = aws_cognito_user_pool.testrunner[0].id
  username           = each.value.email
  temporary_password = each.value.temporary_password

  attributes = {
    email          = each.value.email
    email_verified = true
  }

  lifecycle {
    # Avoid perpetual diffs / accidental password resets on every apply —
    # Cognito doesn't return the password back for comparison anyway.
    ignore_changes = [temporary_password]
  }
}

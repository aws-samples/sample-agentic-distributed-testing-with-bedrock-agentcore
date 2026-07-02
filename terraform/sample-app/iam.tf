/**
 * CardDemo (Spring Boot + SQLite) makes no AWS API calls of its own, so its
 * pods run under a plain ServiceAccount with no IRSA role annotation — no
 * IAM role to create here, unlike testrunner's task role.
 */

resource "kubernetes_service_account_v1" "sample_app" {
  metadata {
    name      = "${local.name_prefix}-sa"
    namespace = kubernetes_namespace_v1.app.metadata[0].name
  }
}

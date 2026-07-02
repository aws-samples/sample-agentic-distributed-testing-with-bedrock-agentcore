/**
 * Optional persistent storage for the backend's SQLite file
 * (spring.datasource.url=jdbc:sqlite:carddemo.db, working dir /app — see
 * sample-app/backend/Dockerfile and application.properties). Fargate pod
 * storage is ephemeral by default, so without this the demo silently resets
 * to its seeded schema/data on every pod restart or redeploy.
 *
 * Enabled via var.enable_efs (default false, since "data resets on restart"
 * is a perfectly reasonable trade-off for a sample/demo app, and skipping
 * EFS keeps the stack simpler and cheaper). Flip it on for a longer-lived
 * demo where losing data on restart would be annoying.
 *
 * Uses static provisioning (a PersistentVolume referencing the EFS access
 * point directly) rather than the EFS CSI driver's dynamic provisioning —
 * simpler for a single fixed volume shared by exactly one Deployment, no
 * StorageClass needed.
 */

resource "aws_efs_file_system" "carddemo_db" {
  count = var.enable_efs ? 1 : 0

  creation_token   = "${local.name_prefix}-db"
  encrypted        = true
  performance_mode = "generalPurpose"

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-db" })
}

resource "aws_efs_mount_target" "carddemo_db" {
  count = var.enable_efs ? length(local.private_subnet_ids) : 0

  file_system_id  = aws_efs_file_system.carddemo_db[0].id
  subnet_id       = local.private_subnet_ids[count.index]
  security_groups = [aws_security_group.efs[0].id]
}

resource "aws_security_group" "efs" {
  count       = var.enable_efs ? 1 : 0
  name        = "${local.name_prefix}-efs-sg"
  description = "Allows NFS from the backend pod to the CardDemo EFS mount target"
  vpc_id      = local.vpc_id

  ingress {
    description     = "NFS from backend pod (EKS cluster security group)"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [module.eks_cluster.cluster_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_efs_access_point" "carddemo_db" {
  count          = var.enable_efs ? 1 : 0
  file_system_id = aws_efs_file_system.carddemo_db[0].id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/carddemo-db"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0755"
    }
  }

  tags = local.common_tags
}

resource "kubernetes_persistent_volume_v1" "carddemo_db" {
  count = var.enable_efs ? 1 : 0

  metadata {
    name = "${local.name_prefix}-db-pv"
  }

  spec {
    capacity = {
      storage = "5Gi" # EFS ignores this — required by the PV/PVC API shape, not enforced
    }
    volume_mode                      = "Filesystem"
    access_modes                     = ["ReadWriteMany"]
    persistent_volume_reclaim_policy = "Retain"
    storage_class_name               = ""

    persistent_volume_source {
      csi {
        driver        = "efs.csi.aws.com"
        volume_handle = "${aws_efs_file_system.carddemo_db[0].id}::${aws_efs_access_point.carddemo_db[0].id}"
      }
    }
  }

  depends_on = [module.eks_cluster]
}

resource "kubernetes_persistent_volume_claim_v1" "carddemo_db" {
  count = var.enable_efs ? 1 : 0

  metadata {
    name      = "${local.name_prefix}-db-pvc"
    namespace = kubernetes_namespace_v1.app.metadata[0].name
  }

  spec {
    access_modes       = ["ReadWriteMany"]
    storage_class_name = ""
    volume_name        = kubernetes_persistent_volume_v1.carddemo_db[0].metadata[0].name

    resources {
      requests = {
        storage = "5Gi"
      }
    }
  }
}

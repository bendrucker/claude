# Mined eval corpora, too personal to commit to this public repo. The
# `ben-drucker-agents-` prefix is the whole of this workspace's S3 grant.
resource "aws_s3_bucket" "eval_corpus" {
  bucket = "ben-drucker-agents-eval-corpus"
}

resource "aws_s3_bucket_versioning" "eval_corpus" {
  bucket = aws_s3_bucket.eval_corpus.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "eval_corpus" {
  bucket = aws_s3_bucket.eval_corpus.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "eval_corpus" {
  bucket = aws_s3_bucket.eval_corpus.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "eval_corpus" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.eval_corpus.arn,
      "${aws_s3_bucket.eval_corpus.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "eval_corpus" {
  bucket = aws_s3_bucket.eval_corpus.id
  policy = data.aws_iam_policy_document.eval_corpus.json
}

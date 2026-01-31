resource "aws_s3_bucket" "question_sets" {
  bucket = "${local.name}-question-sets"
}

resource "aws_s3_bucket_public_access_block" "question_sets" {
  bucket = aws_s3_bucket.question_sets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "question_sets" {
  bucket = aws_s3_bucket.question_sets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "question_sets" {
  bucket = aws_s3_bucket.question_sets.id

  cors_rule {
    allowed_methods = ["GET", "PUT"]
    allowed_origins = distinct(concat(
      [for o in var.callback_urls : trimsuffix(o, "/")],
      local.amplify_origins,
      local.custom_origins,
    ))
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}


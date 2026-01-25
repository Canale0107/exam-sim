data "archive_file" "lambda_question_sets_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/question_sets"
  output_path = "${path.module}/.terraform/lambda-question-sets.zip"
}

resource "aws_iam_role_policy" "lambda_question_sets_s3" {
  name = "${local.name}-lambda-question-sets-s3"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.question_sets.arn
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "question-sets/*"
            ]
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.question_sets.arn}/*"
      }
    ]
  })
}

resource "aws_lambda_function" "question_sets" {
  function_name = "${local.name}-question-sets"
  role          = aws_iam_role.lambda_exec.arn

  runtime = "python3.12"
  handler = "index.handler"

  filename         = data.archive_file.lambda_question_sets_zip.output_path
  source_code_hash = data.archive_file.lambda_question_sets_zip.output_base64sha256

  environment {
    variables = {
      QUESTION_SETS_BUCKET = aws_s3_bucket.question_sets.bucket
    }
  }
}


data "archive_file" "lambda_progress_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/progress"
  output_path = "${path.module}/.terraform/lambda-progress.zip"
}

resource "aws_iam_role_policy" "lambda_progress_ddb" {
  name = "${local.name}-lambda-progress-ddb"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem"
        ]
        Resource = aws_dynamodb_table.progress.arn
      }
    ]
  })
}

resource "aws_lambda_function" "progress" {
  function_name = "${local.name}-progress"
  role          = aws_iam_role.lambda_exec.arn

  runtime = "python3.12"
  handler = "index.handler"

  filename         = data.archive_file.lambda_progress_zip.output_path
  source_code_hash = data.archive_file.lambda_progress_zip.output_base64sha256

  environment {
    variables = {
      PROGRESS_TABLE = aws_dynamodb_table.progress.name
    }
  }
}


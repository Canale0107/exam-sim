data "archive_file" "lambda_me_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/me"
  output_path = "${path.module}/.terraform/lambda-me.zip"
}

resource "aws_iam_role" "lambda_exec" {
  name = "${local.name}-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "me" {
  function_name = "${local.name}-me"
  role          = aws_iam_role.lambda_exec.arn

  runtime = "nodejs20.x"
  handler = "index.handler"

  filename         = data.archive_file.lambda_me_zip.output_path
  source_code_hash = data.archive_file.lambda_me_zip.output_base64sha256
}


locals {
  cognito_issuer = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.this.id}"
  cors_origins   = [for o in var.callback_urls : trimsuffix(o, "/")]
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = true
    allow_headers     = ["authorization", "content-type"]
    allow_methods     = ["GET", "PUT", "POST", "OPTIONS"]
    allow_origins     = local.cors_origins
  }
}

resource "aws_apigatewayv2_authorizer" "cognito_jwt" {
  api_id          = aws_apigatewayv2_api.http.id
  authorizer_type = "JWT"
  name            = "${local.name}-cognito-jwt"

  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = local.cognito_issuer
  }
}

resource "aws_apigatewayv2_integration" "lambda_me" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.me.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "me" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /me"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id

  target = "integrations/${aws_apigatewayv2_integration.lambda_me.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "allow_apigw_invoke_me" {
  statement_id  = "AllowExecutionFromAPIGatewayV2"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.me.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_apigatewayv2_integration" "lambda_progress" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.progress.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "progress_get" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /progress"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id

  target = "integrations/${aws_apigatewayv2_integration.lambda_progress.id}"
}

resource "aws_apigatewayv2_route" "progress_put" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "PUT /progress"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id

  target = "integrations/${aws_apigatewayv2_integration.lambda_progress.id}"
}

resource "aws_lambda_permission" "allow_apigw_invoke_progress" {
  statement_id  = "AllowExecutionFromAPIGatewayV2Progress"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.progress.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_apigatewayv2_integration" "lambda_question_sets" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.question_sets.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "question_sets_upload_url" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /question-sets/upload-url"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id

  target = "integrations/${aws_apigatewayv2_integration.lambda_question_sets.id}"
}

resource "aws_apigatewayv2_route" "question_sets_list" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /question-sets"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id

  target = "integrations/${aws_apigatewayv2_integration.lambda_question_sets.id}"
}

resource "aws_apigatewayv2_route" "question_sets_download_url" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /question-sets/download-url"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id

  target = "integrations/${aws_apigatewayv2_integration.lambda_question_sets.id}"
}

resource "aws_lambda_permission" "allow_apigw_invoke_question_sets" {
  statement_id  = "AllowExecutionFromAPIGatewayV2QuestionSets"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.question_sets.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}


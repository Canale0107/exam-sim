output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_domain" {
  value = "${aws_cognito_user_pool_domain.this.domain}.auth.${var.region}.amazoncognito.com"
}

output "http_api_base_url" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "http_api_me_url" {
  value = "${aws_apigatewayv2_api.http.api_endpoint}/me"
}


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

output "http_api_progress_url" {
  value = "${aws_apigatewayv2_api.http.api_endpoint}/progress"
}

output "http_api_question_sets_upload_url" {
  value = "${aws_apigatewayv2_api.http.api_endpoint}/question-sets/upload-url"
}

output "http_api_question_sets_list_url" {
  value = "${aws_apigatewayv2_api.http.api_endpoint}/question-sets"
}

output "http_api_question_sets_download_url" {
  value = "${aws_apigatewayv2_api.http.api_endpoint}/question-sets/download-url"
}

output "s3_question_sets_bucket" {
  value = aws_s3_bucket.question_sets.bucket
}

output "amplify_app_url" {
  value       = "${local.amplify_branch_url}/"
  description = "Amplify Hosting frontend URL"
}


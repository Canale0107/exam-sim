locals {
  amplify_branch_name = "main"
  amplify_domain      = "${aws_amplify_app.frontend.default_domain}"
  amplify_branch_url  = "https://${local.amplify_branch_name}.${local.amplify_domain}"
}

resource "aws_amplify_app" "frontend" {
  name     = "${local.name}-frontend"
  platform = "WEB"

  build_spec = file("${path.module}/../amplify.yml")
}

resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.frontend.id
  branch_name = local.amplify_branch_name

  environment_variables = {
    NEXT_PUBLIC_COGNITO_DOMAIN       = "${aws_cognito_user_pool_domain.this.domain}.auth.${var.region}.amazoncognito.com"
    NEXT_PUBLIC_COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
    NEXT_PUBLIC_API_BASE_URL         = aws_apigatewayv2_api.http.api_endpoint
    NEXT_PUBLIC_COGNITO_REDIRECT_URI = "${local.amplify_branch_url}/"
    NEXT_PUBLIC_COGNITO_LOGOUT_URI   = "${local.amplify_branch_url}/"
  }
}

# Amplify app is created manually via AWS Console (with GitHub connection).
# Terraform only uses the Amplify domain for CORS / Cognito callback configuration.

locals {
  amplify_branch_url = var.amplify_domain != "" ? "https://main.${var.amplify_domain}" : ""
  amplify_origins    = local.amplify_branch_url != "" ? [local.amplify_branch_url] : []
  amplify_urls       = local.amplify_branch_url != "" ? ["${local.amplify_branch_url}/"] : []
}

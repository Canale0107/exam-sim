variable "project_name" {
  type        = string
  description = "Project name prefix for resources."
  default     = "exam-sim"
}

variable "region" {
  type        = string
  description = "AWS region."
  default     = "ap-northeast-1"
}

variable "cognito_domain_prefix" {
  type        = string
  description = "Cognito hosted UI domain prefix (must be globally unique per region)."
  default     = "exam-sim"
}

variable "amplify_domain" {
  type        = string
  description = "Amplify app default domain (e.g. d1abc2def3.amplifyapp.com). Set after creating the app in Amplify Console."
  default     = ""
}

variable "callback_urls" {
  type        = list(string)
  description = "Allowed OAuth callback URLs for Cognito hosted UI."
  default     = ["http://localhost:3000/"]
}

variable "logout_urls" {
  type        = list(string)
  description = "Allowed logout URLs for Cognito hosted UI."
  default     = ["http://localhost:3000/"]
}


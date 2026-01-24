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


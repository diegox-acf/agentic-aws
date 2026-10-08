variable "project" {
  type        = string
  description = "Project name, used in resource names."
}

variable "env" {
  type        = string
  description = "Environment name."
}

variable "limit_usd" {
  type        = string
  description = "Monthly budget in USD."
}

variable "actual_thresholds" {
  type        = list(number)
  description = "Percent of the limit that triggers an ACTUAL-spend email."
  default     = [50, 80, 100]
}

variable "email" {
  type        = string
  description = "Where budget alerts go."
}

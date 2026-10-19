variable "project" {
  type        = string
  description = "Project name, used in resource names."
}

variable "env" {
  type        = string
  description = "Environment name."
}

variable "name" {
  type        = string
  description = "Function name suffix; the full name is <project>-<env>-<name>."
}

variable "source_dir" {
  type        = string
  description = "Directory to zip as the function code; must contain the bootstrap binary."
}

variable "policy_statements" {
  type = list(object({
    actions   = list(string)
    resources = list(string)
  }))
  default     = []
  description = "Allow statements for the execution role, e.g. DynamoDB actions on one table ARN."

  validation {
    condition = alltrue([
      for s in var.policy_statements : !contains(s.actions, "*") && !contains(s.resources, "*")
    ])
    error_message = "policy_statements must not use \"*\" as an action or resource; scope to ARNs."
  }
}

variable "env_vars" {
  type        = map(string)
  default     = {}
  description = "Environment variables passed to the function."
}

variable "memory_size" {
  type        = number
  default     = 128
  description = "Memory in MB; CPU scales with it. 128 is the minimum and cheapest."

  validation {
    condition     = var.memory_size >= 128 && var.memory_size <= 10240
    error_message = "memory_size must be between 128 and 10240 MB."
  }
}

variable "timeout" {
  type        = number
  default     = 10
  description = "Max seconds per invocation. HTTP API gives up after 30, so stay below that."

  validation {
    condition     = var.timeout >= 1 && var.timeout <= 900
    error_message = "timeout must be between 1 and 900 seconds."
  }
}

variable "alarm_email" {
  type        = string
  default     = null
  description = "Email notified by the error alarms via SNS. If null, no topic or alarms are created."

  validation {
    # Terraform does not short-circuit ||, so regex(null) would error; use a conditional.
    condition     = var.alarm_email == null ? true : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alarm_email))
    error_message = "alarm_email must be null or an email address."
  }
}

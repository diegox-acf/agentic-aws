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
  description = "Directory to zip as the function code, entry point at its root: the bootstrap binary for provided.* runtimes, the bundled .js file for Node.js."
}

variable "runtime" {
  type        = string
  default     = "provided.al2023"
  description = "Lambda runtime id: provided.al2023 for a Go binary, or e.g. nodejs22.x."

  validation {
    condition     = trimspace(var.runtime) != ""
    error_message = "runtime must be non-empty."
  }
}

variable "handler" {
  type        = string
  default     = "bootstrap"
  description = "Entry point. Required but ignored by provided.* runtimes; Node.js uses \"<file>.<export>\", e.g. index.handler."

  validation {
    condition     = trimspace(var.handler) != ""
    error_message = "handler must be non-empty."
  }
}

# A string, not a list: Lambda accepts exactly one architecture per function.
variable "architecture" {
  type        = string
  default     = "arm64"
  description = "CPU architecture. arm64 (Graviton) costs about 20% less per GB-second than x86_64."

  validation {
    condition     = contains(["x86_64", "arm64"], var.architecture)
    error_message = "architecture must be x86_64 or arm64."
  }
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

variable "sqs_trigger" {
  type = object({
    queue_arn           = string
    batch_size          = optional(number, 1)
    maximum_concurrency = optional(number, 2)
  })
  default     = null
  description = "Invoke the function from an SQS queue (event source mapping, with ReportBatchItemFailures). Null: no trigger. The role also needs sqs:ReceiveMessage, DeleteMessage and GetQueueAttributes on the queue (policy_statements)."

  # A conditional, not ||: it guarantees the attributes of a null trigger are never read.
  validation {
    condition = var.sqs_trigger == null ? true : (
      var.sqs_trigger.batch_size >= 1 && var.sqs_trigger.batch_size <= 10 &&
      var.sqs_trigger.maximum_concurrency >= 2 && var.sqs_trigger.maximum_concurrency <= 1000
    )
    error_message = "sqs_trigger.batch_size must be 1-10 and maximum_concurrency 2-1000 (AWS's minimum is 2)."
  }
}

variable "alarms_enabled" {
  type        = bool
  default     = true
  description = "Create the SNS topic, the Errors and AppErrors alarms, and the ERROR-log metric filter."
}

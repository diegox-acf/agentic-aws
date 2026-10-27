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
  description = "Bucket name suffix; the bucket is <project>-<env>-<name>-<account id>."
}

variable "incoming_prefix" {
  type        = string
  default     = "incoming/"
  description = "Key prefix that uploads land under (and that the lifecycle rule expires)."

  validation {
    condition     = can(regex("^[a-z0-9-]+/$", var.incoming_prefix))
    error_message = "incoming_prefix must be lowercase letters, digits or dashes ending in \"/\", e.g. \"incoming/\"."
  }
}

# The EventBridge rule's target and the queue whose policy lets that rule send to it.
variable "queue_arn" {
  type        = string
  description = "ARN of the SQS queue that receives \"Object Created\" events (the EventBridge rule's target)."
}

variable "queue_url" {
  type        = string
  description = "URL of that queue, for its aws_sqs_queue_policy."
}

variable "incoming_expiration_days" {
  type        = number
  default     = 7
  description = "Days after which uploaded files are deleted. The importer reads them within minutes."

  validation {
    condition     = var.incoming_expiration_days >= 1 && floor(var.incoming_expiration_days) == var.incoming_expiration_days
    error_message = "incoming_expiration_days must be a whole number of at least 1."
  }
}

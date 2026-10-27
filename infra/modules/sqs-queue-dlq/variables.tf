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
  description = "Queue name suffix; the queues are <project>-<env>-<name> and <project>-<env>-<name>-dlq."
}

variable "visibility_timeout_seconds" {
  type        = number
  description = "How long a received message stays hidden. Must exceed the consumer's timeout (AWS advises 6x the Lambda timeout), or a slow run is delivered again while still running."

  validation {
    condition     = var.visibility_timeout_seconds >= 0 && var.visibility_timeout_seconds <= 43200
    error_message = "visibility_timeout_seconds must be between 0 and 43200 (12 hours)."
  }
}

variable "max_receive_count" {
  type        = number
  default     = 3
  description = "Receives before a message moves to the DLQ. Each failed Lambda run is one receive."

  validation {
    condition     = var.max_receive_count >= 1 && var.max_receive_count <= 1000
    error_message = "max_receive_count must be between 1 and 1000."
  }
}

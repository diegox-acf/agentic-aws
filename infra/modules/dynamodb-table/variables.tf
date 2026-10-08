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
  description = "Table name suffix; the full name is <project>-<env>-<name>."
}

variable "hash_key" {
  type        = string
  description = "Partition key attribute name (string type)."
}

variable "ttl_attribute" {
  type        = string
  default     = null
  description = "Number attribute holding the expiry epoch seconds. If null, TTL is disabled."

  validation {
    # Terraform does not short-circuit ||, so length(null) would error; use a conditional.
    condition     = var.ttl_attribute == null ? true : length(var.ttl_attribute) > 0
    error_message = "ttl_attribute must be null or a non-empty attribute name."
  }
}

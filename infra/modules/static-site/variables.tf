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
  description = "Site name suffix; resources are named <project>-<env>-<name>."
}

variable "price_class" {
  type        = string
  default     = "PriceClass_100"
  description = "CloudFront edge locations to use. PriceClass_100 is North America and Europe only (cheapest)."

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be PriceClass_100, PriceClass_200 or PriceClass_All."
  }
}

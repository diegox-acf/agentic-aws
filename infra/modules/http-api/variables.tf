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
  description = "API name suffix; the full name is <project>-<env>-<name>."
}

variable "lambda_function_name" {
  type        = string
  description = "Name of the Lambda function the API invokes (for the invoke permission)."
}

variable "lambda_invoke_arn" {
  type        = string
  description = "Invoke ARN of the Lambda function (the integration URI)."
}

variable "routes" {
  type        = list(string)
  description = "Route keys sent to the Lambda, e.g. \"POST /links\"."

  validation {
    condition = length(var.routes) > 0 && alltrue([
      for r in var.routes : can(regex("^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY) /", r))
    ])
    error_message = "routes must be non-empty route keys of the form \"<METHOD> /<path>\"."
  }
}

variable "throttling_rate_limit" {
  type        = number
  default     = 10
  description = "Steady-state requests per second allowed on the stage."
}

variable "throttling_burst_limit" {
  type        = number
  default     = 20
  description = "Maximum burst of concurrent requests allowed on the stage."
}

variable "cors_origins" {
  type        = list(string)
  default     = []
  description = "Browser origins allowed to call the API (CORS), e.g. \"https://d111.cloudfront.net\". Empty disables CORS."

  # An origin is scheme://host[:port] with no path or trailing slash: "https://x.net/" never
  # matches the browser's Origin header. "*" would let any website's scripts read responses.
  validation {
    condition = alltrue([
      for o in var.cors_origins : can(regex("^https?://[A-Za-z0-9.-]+(:[0-9]+)?$", o))
    ])
    error_message = "cors_origins must be origins like \"https://example.com\" or \"http://localhost:3000\": no \"*\", path or trailing slash."
  }
}

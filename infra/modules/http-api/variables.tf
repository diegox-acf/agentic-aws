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

# Keyed by a static name, never by function_name: for_each keys must be known at plan time,
# and a function that doesn't exist yet has no name until apply.
variable "functions" {
  type = map(object({
    invoke_arn    = string # the integration URI
    function_name = string # for the invoke permission
  }))
  description = "Lambda functions the API invokes, keyed by a static name (e.g. \"shortener\") that routes refer to."

  # Each permission adds statement "AllowHttpApiInvoke" to its function's policy; two keys on
  # one function would collide at apply (ResourceConflictException), so catch it at plan.
  validation {
    condition = length(var.functions) > 0 && length(distinct([
      for f in values(var.functions) : f.function_name
    ])) == length(var.functions)
    error_message = "functions must be non-empty, and each key must name a different function."
  }
}

variable "routes" {
  type        = map(string)
  description = "Route key -> key in var.functions, e.g. { \"POST /links\" = \"shortener\" }."

  validation {
    condition = length(var.routes) > 0 && alltrue([
      for r in keys(var.routes) : can(regex("^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY) /", r))
    ])
    error_message = "routes must be non-empty route keys of the form \"<METHOD> /<path>\"."
  }

  validation {
    condition     = alltrue([for f in values(var.routes) : contains(keys(var.functions), f)])
    error_message = "every routes value must be a key of var.functions."
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

variable "route_throttling" {
  type = map(object({
    rate_limit  = number
    burst_limit = number
  }))
  default     = {}
  description = "Tighter limits for single routes, keyed by route key (e.g. an expensive \"POST /imports\"). Other routes keep the stage limits."

  validation {
    condition     = alltrue([for r in keys(var.route_throttling) : contains(keys(var.routes), r)])
    error_message = "every route_throttling key must be a route key in var.routes."
  }
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

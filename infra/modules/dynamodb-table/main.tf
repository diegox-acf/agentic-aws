resource "aws_dynamodb_table" "this" {
  name         = "${var.project}-${var.env}-${var.name}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = var.hash_key

  attribute {
    name = var.hash_key
    type = "S"
  }

  ttl {
    enabled        = var.ttl_attribute != null
    attribute_name = var.ttl_attribute
  }

  # A ceiling on the on-demand write rate. Writes above it are throttled, so it also caps the
  # daily write bill at max_write_request_units x 86,400 x the per-write price.
  dynamic "on_demand_throughput" {
    for_each = var.max_write_request_units == null ? [] : [var.max_write_request_units]
    content {
      max_write_request_units = on_demand_throughput.value
    }
  }

  point_in_time_recovery {
    enabled = false
  }
  deletion_protection_enabled = false
}

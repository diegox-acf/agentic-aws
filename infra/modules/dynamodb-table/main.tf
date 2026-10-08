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

  point_in_time_recovery {
    enabled = false
  }
  deletion_protection_enabled = false
}

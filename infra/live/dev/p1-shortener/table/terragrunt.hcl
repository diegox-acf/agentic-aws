include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/dynamodb-table"
}

inputs = {
  name          = "links"
  hash_key      = "code"
  ttl_attribute = "expiresAt"

  # POST /imports needs no login and turns one request into up to MAX_ROWS writes here. The API
  # throttle limits the request rate, not the daily total; this caps the bill instead:
  # 50 WRU/s x 86,400 s x $0.625 per million = about $2.70/day at worst.
  max_write_request_units = 50
}

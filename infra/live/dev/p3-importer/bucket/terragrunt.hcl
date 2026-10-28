include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/import-bucket"
}

# M3's EventBridge rule targets this queue, and its queue policy lives with the rule.
dependency "queue" {
  config_path = "../queue"
  mock_outputs = {
    queue_arn       = "arn:aws:sqs:us-east-1:111111111111:mock-imports"
    queue_url       = "https://sqs.us-east-1.amazonaws.com/111111111111/mock-imports"
    alarm_topic_arn = "arn:aws:sns:us-east-1:111111111111:mock-imports-alarms"
  }
}

inputs = {
  name            = "imports"
  queue_arn       = dependency.queue.outputs.queue_arn
  queue_url       = dependency.queue.outputs.queue_url
  alarm_topic_arn = dependency.queue.outputs.alarm_topic_arn # same inbox as the DLQ alarm
}

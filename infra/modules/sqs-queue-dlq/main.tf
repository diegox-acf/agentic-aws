locals {
  queue_name = "${var.project}-${var.env}-${var.name}"
}

# 1. Dead-letter queue: where a message goes after max_receive_count failed attempts, so one bad
#    file can't be retried forever. Kept 14 days (the maximum) to give you time to look.
resource "aws_sqs_queue" "dlq" {
  name                      = "${local.queue_name}-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true    # SSE-SQS: free, AWS-managed keys
}

# 2. The work queue.
resource "aws_sqs_queue" "this" {
  name                       = local.queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  receive_wait_time_seconds  = 20 # long polling: fewer empty (but billed) receives
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# Only this queue may use the DLQ, and "Start DLQ redrive" moves messages back to it.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.this.arn]
  })
}

# 3. Alarm: anything in the DLQ means a file failed every attempt. Subscriptions are added
#    outside Terraform (aws sns subscribe), like the Lambda alarms.
resource "aws_sns_topic" "alarms" {
  name = "${local.queue_name}-alarms"
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "${local.queue_name}-dlq-not-empty"
  alarm_description   = "Messages in ${aws_sqs_queue.dlq.name}: an import failed ${var.max_receive_count} times. Inspect, fix, then redrive."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  # SQS stops sending metrics for a queue idle for 6 hours (empty, no API calls): that's healthy.
  treat_missing_data = "notBreaching"
  alarm_actions      = [aws_sns_topic.alarms.arn]
  ok_actions         = [aws_sns_topic.alarms.arn]
}

locals {
  function_name = "${var.project}-${var.env}-${var.name}"
}

# 1. The code: a zip of source_dir, with the entry point (bootstrap or the bundled .js) at its root.
data "archive_file" "code" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/build/${local.function_name}.zip"
  # Zips built on Windows carry no Unix permissions; without this Lambda can't execute a custom
  # runtime's bootstrap (Runtime.InvalidEntrypoint). Node.js only reads its files, so 0755 is harmless.
  output_file_mode = "0755"
}

# 2. Trust policy: WHO may assume the role. Only the Lambda service.
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = local.function_name
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# 3. Permission policy: WHAT the role may do once assumed.
data "aws_iam_policy_document" "permissions" {
  dynamic "statement" {
    for_each = var.policy_statements
    content {
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }

  # Write to this function's log group only. No logs:CreateLogGroup: Terraform owns the group.
  statement {
    actions = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      aws_cloudwatch_log_group.this.arn,
      "${aws_cloudwatch_log_group.this.arn}:*", # log streams live under the group
    ]
  }
}

resource "aws_iam_role_policy" "this" {
  name   = local.function_name
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.permissions.json
}

# 4. Log group: the name Lambda writes to by default, created here so retention is set.
resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 7
}

# 5. The function.
resource "aws_lambda_function" "this" {
  function_name = local.function_name
  role          = aws_iam_role.this.arn
  runtime       = var.runtime
  architectures = [var.architecture]
  handler       = var.handler
  filename      = data.archive_file.code.output_path
  # filename never changes; the hash is what makes a rebuilt binary or bundle deploy.
  source_code_hash = data.archive_file.code.output_base64sha256
  memory_size      = var.memory_size
  timeout          = var.timeout

  environment {
    variables = var.env_vars
  }

  # The first invoke must find its log group and permissions already in place.
  depends_on = [aws_cloudwatch_log_group.this, aws_iam_role_policy.this]
}

# 6. Alarms: on failed invocations and on app errors, published to an SNS topic.
locals {
  alarms = var.alarms_enabled ? 1 : 0
}

# Email subscriptions are added outside Terraform (aws sns subscribe), so no plan or destroy
# ever needs a personal address, and it never lands in state. Deleting the topic removes them.
resource "aws_sns_topic" "alarms" {
  count = local.alarms
  name  = "${local.function_name}-alarms"
}

# AWS/Lambda Errors counts FAILED invocations: crashes, timeouts, init failures. A handled
# error the app answers with an HTTP 500 is a successful invocation and does not count.
resource "aws_cloudwatch_metric_alarm" "errors" {
  count               = local.alarms
  alarm_name          = "${local.function_name}-errors"
  alarm_description   = "Invocations failed (crash, timeout or init error)."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.this.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching" # no invocations is healthy, not "insufficient data"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}

# Handled errors: each JSON log line with "level":"ERROR" adds 1 to a custom metric. Go's slog and
# Powertools Logger write that; console.error (plain text) and pino (numeric levels) never match.
resource "aws_cloudwatch_log_metric_filter" "app_errors" {
  count          = local.alarms
  name           = "${local.function_name}-app-errors"
  log_group_name = aws_cloudwatch_log_group.this.name
  pattern        = "{ $.level = \"ERROR\" }"

  metric_transformation {
    name      = "AppErrors"
    namespace = "${var.project}/${var.env}/${var.name}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "app_errors" {
  count               = local.alarms
  alarm_name          = "${local.function_name}-app-errors"
  alarm_description   = "The app logged an ERROR (e.g. a DynamoDB failure answered with a 500)."
  namespace           = aws_cloudwatch_log_metric_filter.app_errors[0].metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.app_errors[0].metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}

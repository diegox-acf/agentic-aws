locals {
  function_name = "${var.project}-${var.env}-${var.name}"
}

# 1. The code: a zip with the "bootstrap" binary at its root.
data "archive_file" "code" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/build/${local.function_name}.zip"
  # Zips built on Windows carry no Unix permissions; without this Lambda can't execute bootstrap.
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
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  handler       = "bootstrap" # ignored by custom runtimes, but required
  filename      = data.archive_file.code.output_path
  # filename never changes; the hash is what makes a rebuilt binary deploy.
  source_code_hash = data.archive_file.code.output_base64sha256
  memory_size      = var.memory_size
  timeout          = var.timeout

  environment {
    variables = var.env_vars
  }

  # The first invoke must find its log group and permissions already in place.
  depends_on = [aws_cloudwatch_log_group.this, aws_iam_role_policy.this]
}

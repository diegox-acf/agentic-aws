# A topic publishers send to and subscribers (email, SQS, Lambda) receive from: fan-out without
# the publisher knowing who listens. No topic policy: the default lets this account's IAM
# principals publish, and each publisher's role grants sns:Publish on this ARN only.
# Email subscriptions are added outside Terraform (aws sns subscribe), so no plan or destroy
# needs a personal address; deleting the topic removes them.
resource "aws_sns_topic" "this" {
  name = "${var.project}-${var.env}-${var.name}"
}

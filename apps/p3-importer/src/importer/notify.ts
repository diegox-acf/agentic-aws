import { PublishCommand, type SNSClient } from "@aws-sdk/client-sns";
import type { ImportSummary } from "../domain/imports";

export type Notify = (summary: ImportSummary) => Promise<void>;

const MAX_SUBJECT_LENGTH = 100; // SNS rejects longer subjects (they become the email subject)

/** Publishes an import's outcome to the results topic; email subscribers get it as a message. */
export function snsNotifier(sns: SNSClient, topicArn: string): Notify {
  return async (summary) => {
    const subject = `Import ${summary.status}: ${summary.created} created, ${summary.rejected} rejected`;
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: subject.slice(0, MAX_SUBJECT_LENGTH),
        Message: JSON.stringify(summary, null, 2),
      }),
    );
  };
}

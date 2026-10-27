import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { deterministicCode } from "../domain/code";
import { toLinkItem } from "../domain/link";

export type LinkOutcome = "created" | "already-imported" | "collision";

/** Codes tried per row before giving up, as P1 does for its random codes. */
export const MAX_CODE_ATTEMPTS = 3;

export interface ImportedRow {
  importId: string;
  row: number;
  url: string;
  now: Date;
}

/**
 * Writes one imported link into P1's links table without ever overwriting an existing link
 * (ADR 0004). BatchWriteItem can't take a condition, so this is one conditional PutItem per row:
 *   - the code is free: created;
 *   - the code holds this import's link for this URL: an earlier delivery wrote it, nothing to do;
 *   - anything else holds it: try the row's next deterministic code, up to MAX_CODE_ATTEMPTS.
 * Other errors (throttling after the SDK's own retries, permissions) are thrown so the SQS
 * message is retried; re-running is safe because every row maps to the same codes.
 */
export async function writeImportedLink(ddb: DynamoDBDocumentClient, linksTable: string, row: ImportedRow): Promise<LinkOutcome> {
  const { importId, url, now } = row;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = deterministicCode(importId, row.row, attempt);
    try {
      await ddb.send(
        new PutCommand({
          TableName: linksTable,
          Item: toLinkItem({ code, url, importId, now }),
          ConditionExpression: "attribute_not_exists(code)",
          // On a failed condition, return the item that holds the code: one call, no extra read.
          ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }),
      );
      return "created";
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
      // The document client doesn't unmarshal errors: Item is raw attribute values.
      const existing = error.Item;
      if (existing?.importId?.S === importId && existing.url?.S === url) {
        return "already-imported";
      }
    }
  }
  return "collision";
}

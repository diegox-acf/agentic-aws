import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { ImportRecord, ImportSummary } from "../domain/imports";

export type StartResult =
  | { outcome: "started" }
  | { outcome: "missing" }
  | { outcome: "finished"; summary: ImportSummary; notified: boolean };

export interface ImportsRepo {
  /**
   * PENDING|PROCESSING -> PROCESSING. A guard, not a lock: a crashed run's redelivery may start again.
   * A given-up import starts again too: that's a DLQ redrive, a deliberate retry.
   */
  start(importId: string, now: Date): Promise<StartResult>;
  /** PROCESSING -> DONE|FAILED. False when another delivery finished it first. */
  finish(summary: ImportSummary, now: Date): Promise<boolean>;
  /** PENDING|PROCESSING -> FAILED, marked gaveUp. False when the import is already finished. */
  giveUp(importId: string, error: string, now: Date): Promise<boolean>;
  markNotified(importId: string): Promise<void>;
}

export function importsRepo(ddb: DynamoDBDocumentClient, importsTable: string): ImportsRepo {
  return {
    async start(importId, now) {
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: importsTable,
            Key: { importId },
            // REMOVE clears a given-up run's failure; on any other record those attributes don't exist.
            UpdateExpression: "SET #status = :processing, startedAt = :now REMOVE gaveUp, #error, finishedAt ADD attempts :one",
            ConditionExpression: "attribute_exists(importId) AND (#status IN (:pending, :processing) OR gaveUp = :true)",
            ExpressionAttributeNames: { "#status": "status", "#error": "error" }, // "status" is a DynamoDB reserved word
            ExpressionAttributeValues: { ":pending": "PENDING", ":processing": "PROCESSING", ":true": true, ":now": now.toISOString(), ":one": 1 },
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );
        return { outcome: "started" };
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) {
          throw error;
        }
        if (error.Item === undefined) {
          return { outcome: "missing" };
        }
        // The condition failed on an existing item, so its status is DONE or FAILED.
        const record = unmarshall(error.Item) as ImportRecord;
        return { outcome: "finished", summary: toSummary(record), notified: record.notified === true };
      }
    },

    async finish(summary, now) {
      const { importId, status, created, rejected, rejectedSample, error } = summary;
      // DynamoDB rejects names or values the expressions don't use, so set these only when present.
      const optional = Object.entries({ error, rejectedSample }).filter(([, value]) => value !== undefined);
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: importsTable,
            Key: { importId },
            UpdateExpression: [
              "SET #status = :status, created = :created, rejected = :rejected, finishedAt = :now",
              ...optional.map(([name]) => `#${name} = :${name}`),
            ].join(", "),
            ConditionExpression: "#status = :processing",
            ExpressionAttributeNames: { "#status": "status", ...Object.fromEntries(optional.map(([name]) => [`#${name}`, name])) },
            ExpressionAttributeValues: {
              ":status": status,
              ":created": created,
              ":rejected": rejected,
              ":now": now.toISOString(),
              ":processing": "PROCESSING",
              ...Object.fromEntries(optional.map(([name, value]) => [`:${name}`, value])),
            },
          }),
        );
        return true;
      } catch (caught) {
        if (caught instanceof ConditionalCheckFailedException) {
          return false;
        }
        throw caught;
      }
    },

    async giveUp(importId, error, now) {
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: importsTable,
            Key: { importId },
            UpdateExpression: "SET #status = :failed, #error = :error, finishedAt = :now, gaveUp = :true",
            // A DONE import whose announcement failed stays DONE: its links and counts are real.
            ConditionExpression: "#status IN (:pending, :processing)",
            ExpressionAttributeNames: { "#status": "status", "#error": "error" },
            ExpressionAttributeValues: {
              ":failed": "FAILED",
              ":error": error,
              ":now": now.toISOString(),
              ":true": true,
              ":pending": "PENDING",
              ":processing": "PROCESSING",
            },
          }),
        );
        return true;
      } catch (caught) {
        if (caught instanceof ConditionalCheckFailedException) {
          return false;
        }
        throw caught;
      }
    },

    async markNotified(importId) {
      await ddb.send(
        new UpdateCommand({
          TableName: importsTable,
          Key: { importId },
          UpdateExpression: "SET notified = :true",
          ConditionExpression: "attribute_exists(importId)", // never create a stub record
          ExpressionAttributeValues: { ":true": true },
        }),
      );
    },
  };
}

function toSummary(record: ImportRecord): ImportSummary {
  const { status } = record;
  if (status !== "DONE" && status !== "FAILED") {
    // The start condition failed on an item that isn't finished either: don't guess.
    throw new Error(`unexpected import status ${JSON.stringify(status)} for ${record.importId}`);
  }
  return {
    importId: record.importId,
    status,
    created: record.created ?? 0,
    rejected: record.rejected ?? 0,
    ...(record.rejectedSample === undefined ? {} : { rejectedSample: record.rejectedSample }),
    ...(record.error === undefined ? {} : { error: record.error }),
  };
}

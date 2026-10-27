import { Readable } from "node:stream";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Context, SQSEvent, SQSRecord } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeImporterHandler } from "./handler";
import { snsNotifier } from "./notify";

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const snsMock = mockClient(SNSClient);
const IMPORT_ID = "3f1c2a9e-8b4d-4c6e-9a7f-1b2c3d4e5f60";
const START = "attribute_exists(importId) AND #status IN (:pending, :processing)";
const CONTEXT = { functionName: "importer", awsRequestId: "req-1", getRemainingTimeInMillis: () => 60_000 } as unknown as Context;

function objectCreatedBody(importId = IMPORT_ID): string {
  return JSON.stringify({
    source: "aws.s3",
    "detail-type": "Object Created",
    detail: { bucket: { name: "imports-bucket" }, object: { key: `incoming/${importId}.csv`, size: 30 } },
  });
}

function sqsRecord(messageId: string, body: string): SQSRecord {
  return { messageId, body, receiptHandle: "rh", attributes: {}, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:us-east-1:111111111111:imports", awsRegion: "us-east-1" } as SQSRecord;
}

const sqsEvent = (...records: SQSRecord[]): SQSEvent => ({ Records: records });
const notifiedMarks = () => ddbMock.commandCalls(UpdateCommand).filter((c) => c.args[0].input.UpdateExpression === "SET notified = :true");

function handler() {
  return makeImporterHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })),
    s3: new S3Client({ region: "us-east-1" }),
    clock: () => new Date("2026-10-26T12:00:00.000Z"),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { linksTable: "links", importsTable: "imports", bucketName: "imports-bucket", resultsTopicArn: "arn:aws:sns:us-east-1:111111111111:results", maxUploadBytes: 1_048_576, maxRows: 1000, writeConcurrency: 10 },
    notify: snsNotifier(new SNSClient({ region: "us-east-1" }), "arn:aws:sns:us-east-1:111111111111:results"),
  });
}

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  snsMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from(["https://a.io\n"]) as never });
  snsMock.on(PublishCommand).resolves({});
});

describe("importer handler", () => {
  it("processes the import, announces it once and marks it notified", async () => {
    const response = await handler()(sqsEvent(sqsRecord("m-1", objectCreatedBody())), CONTEXT);

    expect(response).toStrictEqual({ batchItemFailures: [] });
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    expect(notifiedMarks()).toHaveLength(1);
  });

  it("reports only the failed message of a batch, so SQS retries just that one", async () => {
    const response = await handler()(sqsEvent(sqsRecord("bad", "not json"), sqsRecord("good", objectCreatedBody())), CONTEXT);

    expect(response).toStrictEqual({ batchItemFailures: [{ itemIdentifier: "bad" }] });
  });

  it("fails the invocation when its only message fails (counts in the Lambda Errors alarm)", async () => {
    await expect(handler()(sqsEvent(sqsRecord("bad", "not json")), CONTEXT)).rejects.toThrow();
  });

  it("leaves the import unannounced when SNS fails, so the retry announces it", async () => {
    snsMock.on(PublishCommand).rejectsOnce(new Error("SNS down")).resolves({});

    await expect(handler()(sqsEvent(sqsRecord("m-1", objectCreatedBody())), CONTEXT)).rejects.toThrow();
    expect(notifiedMarks()).toHaveLength(0);

    // The retry: the record is DONE now but not notified.
    ddbMock
      .on(UpdateCommand, { ConditionExpression: START })
      .rejects(
        new ConditionalCheckFailedException({
          message: "x",
          $metadata: {},
          Item: { importId: { S: IMPORT_ID }, status: { S: "DONE" }, created: { N: "1" }, rejected: { N: "0" } },
        }),
      );
    const retry = await handler()(sqsEvent(sqsRecord("m-1", objectCreatedBody())), CONTEXT);

    expect(retry).toStrictEqual({ batchItemFailures: [] });
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2);
    expect(notifiedMarks()).toHaveLength(1);
  });

  it("announces nothing for an import that is already finished and announced", async () => {
    ddbMock
      .on(UpdateCommand, { ConditionExpression: START })
      .rejects(
        new ConditionalCheckFailedException({
          message: "x",
          $metadata: {},
          Item: { importId: { S: IMPORT_ID }, status: { S: "DONE" }, created: { N: "1" }, rejected: { N: "0" }, notified: { BOOL: true } },
        }),
      );

    const response = await handler()(sqsEvent(sqsRecord("m-1", objectCreatedBody())), CONTEXT);

    expect(response).toStrictEqual({ batchItemFailures: [] });
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });
});

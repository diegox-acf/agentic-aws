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
const START = "attribute_exists(importId) AND (#status IN (:pending, :processing) OR gaveUp = :true)";
const GIVE_UP = "#status IN (:pending, :processing)";
const CONTEXT = { functionName: "importer", awsRequestId: "req-1", getRemainingTimeInMillis: () => 60_000 } as unknown as Context;

function objectCreatedBody(importId = IMPORT_ID): string {
  return JSON.stringify({
    source: "aws.s3",
    "detail-type": "Object Created",
    detail: { bucket: { name: "imports-bucket" }, object: { key: `incoming/${importId}.csv`, size: 30 } },
  });
}

// receiveCount is how many times SQS has delivered this message, the first delivery included.
function sqsRecord(messageId: string, body: string, receiveCount = "1"): SQSRecord {
  return { messageId, body, receiptHandle: "rh", attributes: { ApproximateReceiveCount: receiveCount }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:us-east-1:111111111111:imports", awsRegion: "us-east-1" } as SQSRecord;
}

const sqsEvent = (...records: SQSRecord[]): SQSEvent => ({ Records: records });
const notifiedMarks = () => ddbMock.commandCalls(UpdateCommand).filter((c) => c.args[0].input.UpdateExpression === "SET notified = :true");
const giveUps = () => ddbMock.commandCalls(UpdateCommand).filter((c) => c.args[0].input.ConditionExpression === GIVE_UP).map((c) => c.args[0].input);
const fakeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function handler(logger = fakeLogger()) {
  return makeImporterHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })),
    s3: new S3Client({ region: "us-east-1" }),
    clock: () => new Date("2026-10-26T12:00:00.000Z"),
    logger,
    config: { linksTable: "links", importsTable: "imports", bucketName: "imports-bucket", resultsTopicArn: "arn:aws:sns:us-east-1:111111111111:results", maxUploadBytes: 1_048_576, maxRows: 1000, writeConcurrency: 10, maxReceiveCount: 3 },
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

  // M5 H2: Powertools records a failed message for retry but logs nothing, and Lambda logs only
  // its "All records failed processing" wrapper, so the handler must log the real cause itself.
  it("logs why an attempt failed, with its import and receive count, and still fails it", async () => {
    const logger = fakeLogger();
    s3Mock.on(GetObjectCommand).rejects(new Error("S3 down"));

    await expect(handler(logger)(sqsEvent(sqsRecord("m-1", objectCreatedBody(), "2")), CONTEXT)).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      "import attempt failed",
      expect.objectContaining({
        importId: IMPORT_ID,
        messageId: "m-1",
        receiveCount: "2",
        // The Error itself, not String(error): the logger then keeps its stack.
        error: expect.objectContaining({ message: "S3 down" }),
      }),
    );
  });

  it("logs a failed announcement too, since it happens after the import is processed", async () => {
    const logger = fakeLogger();
    snsMock.on(PublishCommand).rejects(new Error("SNS down"));

    await expect(handler(logger)(sqsEvent(sqsRecord("m-1", objectCreatedBody())), CONTEXT)).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      "import attempt failed",
      expect.objectContaining({ importId: IMPORT_ID, error: expect.objectContaining({ message: "SNS down" }) }),
    );
  });

  // M5 H1: after maxReceiveCount deliveries SQS moves the message to the DLQ and nothing would
  // ever finish the import: GET would say PROCESSING for 30 days. The last delivery records why.
  it("on the last delivery, marks the import FAILED with the reason, and still fails the message", async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error("S3 down"));

    await expect(handler()(sqsEvent(sqsRecord("m-1", objectCreatedBody(), "3")), CONTEXT)).rejects.toThrow();

    expect(giveUps()).toHaveLength(1);
    expect(giveUps()[0]).toMatchObject({
      Key: { importId: IMPORT_ID },
      // GET shows this to anyone: an SDK message can name roles or the account, so it stays in the logs.
      ExpressionAttributeValues: expect.objectContaining({ ":failed": "FAILED", ":error": "gave up after 3 deliveries; see the importer logs" }),
    });
  });

  it("doesn't give up when the receive count is missing", async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error("S3 down"));
    const record = { ...sqsRecord("m-1", objectCreatedBody()), attributes: {} } as SQSRecord;

    await expect(handler()(sqsEvent(record), CONTEXT)).rejects.toThrow();

    expect(giveUps()).toHaveLength(0);
  });

  it("before the last delivery, leaves the import as it is for the retry", async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error("S3 down"));

    await expect(handler()(sqsEvent(sqsRecord("m-1", objectCreatedBody(), "2")), CONTEXT)).rejects.toThrow();

    expect(giveUps()).toHaveLength(0);
  });

  it("still fails the message, with the original error, when marking the import FAILED fails too", async () => {
    const logger = fakeLogger();
    s3Mock.on(GetObjectCommand).rejects(new Error("S3 down"));
    ddbMock.on(UpdateCommand, { ConditionExpression: GIVE_UP }).rejects(new Error("DynamoDB down"));

    const response = handler(logger)(sqsEvent(sqsRecord("m-1", objectCreatedBody(), "3")), CONTEXT);

    await expect(response).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "could not mark the import FAILED",
      expect.objectContaining({ importId: IMPORT_ID, error: expect.objectContaining({ message: "DynamoDB down" }) }),
    );
  });

  it("leaves a finished import DONE when only its announcement failed on the last delivery", async () => {
    snsMock.on(PublishCommand).rejects(new Error("SNS down"));
    // The record is DONE by then, so the give-up condition fails: nothing to change.
    ddbMock.on(UpdateCommand, { ConditionExpression: GIVE_UP }).rejects(new ConditionalCheckFailedException({ message: "x", $metadata: {} }));

    await expect(handler()(sqsEvent(sqsRecord("m-1", objectCreatedBody(), "3")), CONTEXT)).rejects.toThrow();

    expect(giveUps()).toHaveLength(1); // tried, and the condition kept DONE
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

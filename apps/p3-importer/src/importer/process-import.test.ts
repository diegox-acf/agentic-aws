import { Readable } from "node:stream";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportObject } from "../domain/s3-event";
import type { ImporterConfig } from "../shared/importer-config";
import { processImport, type ProcessDeps } from "./process-import";

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const IMPORT_ID = "3f1c2a9e-8b4d-4c6e-9a7f-1b2c3d4e5f60";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const CONFIG: ImporterConfig = {
  linksTable: "links",
  importsTable: "imports",
  bucketName: "imports-bucket",
  resultsTopicArn: "arn:aws:sns:us-east-1:111111111111:results",
  maxUploadBytes: 1_048_576,
  maxRows: 1000,
  writeConcurrency: 10,
};
const OBJECT: ImportObject = { bucket: "imports-bucket", key: `incoming/${IMPORT_ID}.csv`, size: 100, importId: IMPORT_ID };

const START = "attribute_exists(importId) AND #status IN (:pending, :processing)";
const FINISH = "#status = :processing";

type Log = ProcessDeps["logger"];

let deps: ProcessDeps;
let logger: { info: ReturnType<typeof vi.fn<Log["info"]>>; warn: ReturnType<typeof vi.fn<Log["warn"]>>; error: ReturnType<typeof vi.fn<Log["error"]>> };

function uploaded(csv: string): void {
  s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([csv]) as never });
}

function conditionFailed(item?: Record<string, unknown>): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {}, ...(item ? { Item: item as never } : {}) });
}

const finishCalls = () =>
  ddbMock.commandCalls(UpdateCommand).filter((c) => c.args[0].input.ConditionExpression === FINISH).map((c) => c.args[0].input);
const puts = () => ddbMock.commandCalls(PutCommand).map((c) => c.args[0].input);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  logger = { info: vi.fn<Log["info"]>(), warn: vi.fn<Log["warn"]>(), error: vi.fn<Log["error"]>() };
  deps = {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })),
    s3: new S3Client({ region: "us-east-1" }),
    clock: () => NOW,
    logger,
    config: CONFIG,
  };
});

describe("processImport", () => {
  it("writes every valid row, rejects the rest, and finishes DONE with the counts", async () => {
    uploaded("url\nhttps://a.io\nnot a url\nhttps://b.io\nhttps://c.io,extra\n");

    const summary = await processImport(deps, OBJECT);

    expect(summary).toStrictEqual({ importId: IMPORT_ID, status: "DONE", created: 2, rejected: 2 });
    expect(puts().map((p) => p?.Item?.url)).toStrictEqual(["https://a.io", "https://b.io"]);
    expect(finishCalls()[0]?.ExpressionAttributeValues).toMatchObject({ ":status": "DONE", ":created": 2, ":rejected": 2 });
    expect(s3Mock.commandCalls(GetObjectCommand)[0]?.args[0].input).toStrictEqual({ Bucket: OBJECT.bucket, Key: OBJECT.key });
  });

  it("writes all rows of a file larger than one batch of concurrent writes", async () => {
    uploaded(Array.from({ length: 25 }, (_, i) => `https://example.com/${i}`).join("\n"));

    const summary = await processImport(deps, OBJECT);

    expect(summary?.created).toBe(25);
    expect(new Set(puts().map((p) => p?.Item?.code)).size).toBe(25);
  });

  it("fails a file with more rows than allowed, so one upload can't cost thousands of writes", async () => {
    uploaded(Array.from({ length: 30 }, (_, i) => `https://example.com/${i}`).join("\n"));
    deps = { ...deps, config: { ...CONFIG, maxRows: 25 } };

    const summary = await processImport(deps, OBJECT);

    expect(summary).toMatchObject({ status: "FAILED", error: "more than 25 rows" });
    expect(puts().length).toBeLessThanOrEqual(25);
  });

  it("ignores a message about another bucket, reading only its own", async () => {
    await expect(processImport(deps, { ...OBJECT, bucket: "someone-elses-bucket" })).resolves.toBeUndefined();

    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("fails a file over the size limit without downloading it", async () => {
    const summary = await processImport(deps, { ...OBJECT, size: CONFIG.maxUploadBytes + 1 });

    expect(summary).toStrictEqual({ importId: IMPORT_ID, status: "FAILED", created: 0, rejected: 0, error: "file larger than 1048576 bytes" });
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("fails an import whose file is gone (e.g. expired by the lifecycle rule)", async () => {
    s3Mock.on(GetObjectCommand).rejects(new NoSuchKey({ message: "The specified key does not exist.", $metadata: {} }));

    const summary = await processImport(deps, OBJECT);

    expect(summary).toMatchObject({ status: "FAILED", error: "uploaded file not found" });
  });

  it("fails an import whose CSV can't be parsed, keeping the counts so far", async () => {
    uploaded('https://a.io\n"https://b.io\n');

    const summary = await processImport(deps, OBJECT);

    expect(summary).toMatchObject({ status: "FAILED", created: 0 });
    expect(summary?.error).toMatch(/^invalid CSV: /);
  });

  it("does nothing for an upload with no import record, and logs it as an error", async () => {
    ddbMock.on(UpdateCommand, { ConditionExpression: START }).rejects(conditionFailed());

    await expect(processImport(deps, OBJECT)).resolves.toBeUndefined();

    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("skips an import that is finished and announced", async () => {
    ddbMock
      .on(UpdateCommand, { ConditionExpression: START })
      .rejects(conditionFailed({ importId: { S: IMPORT_ID }, status: { S: "DONE" }, created: { N: "1" }, rejected: { N: "0" }, notified: { BOOL: true } }));

    await expect(processImport(deps, OBJECT)).resolves.toBeUndefined();

    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("returns the stored summary of a finished import that was never announced, without reprocessing", async () => {
    ddbMock
      .on(UpdateCommand, { ConditionExpression: START })
      .rejects(conditionFailed({ importId: { S: IMPORT_ID }, status: { S: "DONE" }, created: { N: "4" }, rejected: { N: "1" } }));

    await expect(processImport(deps, OBJECT)).resolves.toStrictEqual({ importId: IMPORT_ID, status: "DONE", created: 4, rejected: 1 });

    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(puts()).toHaveLength(0);
  });

  it("on redelivery, counts rows it wrote before as created and writes nothing new", async () => {
    uploaded("https://a.io\nhttps://b.io\n");
    // Every code is already held by this import's link for the same URL.
    ddbMock.on(PutCommand).callsFake((input: { Item: { url: string } }) => {
      throw new ConditionalCheckFailedException({
        message: "x",
        $metadata: {},
        Item: { importId: { S: IMPORT_ID }, url: { S: input.Item.url } },
      });
    });

    const summary = await processImport(deps, OBJECT);

    expect(summary).toMatchObject({ status: "DONE", created: 2, rejected: 0 });
  });

  it("throws on a transient DynamoDB error, leaving the import PROCESSING for the retry", async () => {
    uploaded("https://a.io\n");
    ddbMock.on(PutCommand).rejects(new Error("ProvisionedThroughputExceededException"));

    await expect(processImport(deps, OBJECT)).rejects.toThrow("ProvisionedThroughputExceededException");

    expect(finishCalls()).toHaveLength(0);
  });

  it("returns nothing when a concurrent delivery finished the import first", async () => {
    uploaded("https://a.io\n");
    ddbMock.on(UpdateCommand, { ConditionExpression: FINISH }).rejects(conditionFailed());

    await expect(processImport(deps, OBJECT)).resolves.toBeUndefined();
  });
});

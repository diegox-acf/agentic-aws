import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { importsRepo } from "./imports-repo";

const ddbMock = mockClient(DynamoDBDocumentClient);
const repo = importsRepo(DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })), "imports");
const IMPORT_ID = "3f1c2a9e-8b4d-4c6e-9a7f-1b2c3d4e5f60";
const NOW = new Date("2026-10-26T12:00:00.000Z");

function conditionFailed(item?: Record<string, unknown>): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {}, ...(item ? { Item: item as never } : {}) });
}

const updateInputs = () => ddbMock.commandCalls(UpdateCommand).map((c) => c.args[0].input);

beforeEach(() => ddbMock.reset());

describe("start", () => {
  it("moves a PENDING or PROCESSING import to PROCESSING and counts the attempt", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await expect(repo.start(IMPORT_ID, NOW)).resolves.toStrictEqual({ outcome: "started" });

    expect(updateInputs()[0]).toMatchObject({
      TableName: "imports",
      Key: { importId: IMPORT_ID },
      ConditionExpression: "attribute_exists(importId) AND (#status IN (:pending, :processing) OR gaveUp = :true)",
      ExpressionAttributeValues: expect.objectContaining({ ":pending": "PENDING", ":processing": "PROCESSING", ":now": NOW.toISOString(), ":one": 1 }),
      ReturnValuesOnConditionCheckFailure: "ALL_OLD",
    });
  });

  it("starts an import it gave up on again (a DLQ redrive), clearing the old failure", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await repo.start(IMPORT_ID, NOW);

    expect(updateInputs()[0]?.ConditionExpression).toContain("OR gaveUp = :true");
    expect(updateInputs()[0]?.ExpressionAttributeValues).toMatchObject({ ":true": true });
    expect(updateInputs()[0]?.UpdateExpression).toContain("REMOVE gaveUp, #error, finishedAt");
  });

  it("returns the rejected-row sample with a finished import's summary", async () => {
    ddbMock.on(UpdateCommand).rejects(
      conditionFailed({
        importId: { S: IMPORT_ID },
        status: { S: "DONE" },
        created: { N: "1" },
        rejected: { N: "1" },
        rejectedSample: { L: [{ M: { row: { N: "2" }, reason: { S: "invalid URL" } } }] },
      }),
    );

    await expect(repo.start(IMPORT_ID, NOW)).resolves.toMatchObject({
      summary: { importId: IMPORT_ID, status: "DONE", created: 1, rejected: 1, rejectedSample: [{ row: 2, reason: "invalid URL" }] },
    });
  });

  it("reports a missing record", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed());

    await expect(repo.start(IMPORT_ID, NOW)).resolves.toStrictEqual({ outcome: "missing" });
  });

  it("reports a finished import with its summary and whether it was announced", async () => {
    ddbMock.on(UpdateCommand).rejects(
      conditionFailed({
        importId: { S: IMPORT_ID },
        status: { S: "DONE" },
        created: { N: "3" },
        rejected: { N: "1" },
        notified: { BOOL: true },
      }),
    );

    await expect(repo.start(IMPORT_ID, NOW)).resolves.toStrictEqual({
      outcome: "finished",
      summary: { importId: IMPORT_ID, status: "DONE", created: 3, rejected: 1 },
      notified: true,
    });
  });

  it("reports a finished-but-unannounced FAILED import with its reason", async () => {
    ddbMock.on(UpdateCommand).rejects(
      conditionFailed({ importId: { S: IMPORT_ID }, status: { S: "FAILED" }, created: { N: "0" }, rejected: { N: "0" }, error: { S: "too big" } }),
    );

    await expect(repo.start(IMPORT_ID, NOW)).resolves.toStrictEqual({
      outcome: "finished",
      summary: { importId: IMPORT_ID, status: "FAILED", created: 0, rejected: 0, error: "too big" },
      notified: false,
    });
  });

  it("rethrows other errors", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("throttled"));

    await expect(repo.start(IMPORT_ID, NOW)).rejects.toThrow("throttled");
  });

  it("refuses to treat a record in an unexpected state as finished", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed({ importId: { S: IMPORT_ID } })); // no status at all

    await expect(repo.start(IMPORT_ID, NOW)).rejects.toThrow(/unexpected import status/);
  });
});

describe("finish", () => {
  it("records the outcome only while PROCESSING, and says this run finished it", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await expect(repo.finish({ importId: IMPORT_ID, status: "DONE", created: 5, rejected: 2 }, NOW)).resolves.toBe(true);

    expect(updateInputs()[0]).toMatchObject({
      Key: { importId: IMPORT_ID },
      ConditionExpression: "#status = :processing",
      ExpressionAttributeValues: expect.objectContaining({ ":status": "DONE", ":created": 5, ":rejected": 2, ":now": NOW.toISOString() }),
    });
    expect(updateInputs()[0]?.UpdateExpression).not.toContain("#error");
  });

  it("stores the reason of a FAILED import", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await repo.finish({ importId: IMPORT_ID, status: "FAILED", created: 0, rejected: 0, error: "too big" }, NOW);

    expect(updateInputs()[0]?.UpdateExpression).toContain("#error = :error");
    expect(updateInputs()[0]?.ExpressionAttributeValues).toMatchObject({ ":error": "too big" });
  });

  it("stores the sample of rejected rows when there is one", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    const rejectedSample = [{ row: 3, reason: "invalid URL" }];

    await repo.finish({ importId: IMPORT_ID, status: "DONE", created: 2, rejected: 1, rejectedSample }, NOW);

    expect(updateInputs()[0]?.UpdateExpression).toContain("#rejectedSample = :rejectedSample");
    expect(updateInputs()[0]?.ExpressionAttributeValues).toMatchObject({ ":rejectedSample": rejectedSample });
  });

  it("returns false when another delivery finished it first", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed());

    await expect(repo.finish({ importId: IMPORT_ID, status: "DONE", created: 1, rejected: 0 }, NOW)).resolves.toBe(false);
  });

  it("rethrows other errors", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("throttled"));

    await expect(repo.finish({ importId: IMPORT_ID, status: "DONE", created: 1, rejected: 0 }, NOW)).rejects.toThrow("throttled");
  });
});

describe("giveUp", () => {
  it("marks an unfinished import FAILED with the reason, as one a redrive may retry", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await expect(repo.giveUp(IMPORT_ID, "gave up after 3 deliveries: boom", NOW)).resolves.toBe(true);

    expect(updateInputs()[0]).toMatchObject({
      Key: { importId: IMPORT_ID },
      UpdateExpression: "SET #status = :failed, #error = :error, finishedAt = :now, gaveUp = :true",
      ConditionExpression: "#status IN (:pending, :processing)",
      ExpressionAttributeValues: expect.objectContaining({
        ":failed": "FAILED",
        ":error": "gave up after 3 deliveries: boom",
        ":now": NOW.toISOString(),
        ":true": true,
      }),
    });
  });

  it("returns false for an import that finished anyway (only its announcement failed)", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed());

    await expect(repo.giveUp(IMPORT_ID, "x", NOW)).resolves.toBe(false);
  });

  it("rethrows other errors", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("throttled"));

    await expect(repo.giveUp(IMPORT_ID, "x", NOW)).rejects.toThrow("throttled");
  });
});

describe("markNotified", () => {
  it("sets notified on the existing record", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await repo.markNotified(IMPORT_ID);

    expect(updateInputs()[0]).toMatchObject({
      Key: { importId: IMPORT_ID },
      UpdateExpression: "SET notified = :true",
      ConditionExpression: "attribute_exists(importId)",
      ExpressionAttributeValues: { ":true": true },
    });
  });
});

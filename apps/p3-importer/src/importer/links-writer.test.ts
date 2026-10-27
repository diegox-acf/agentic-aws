import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { deterministicCode } from "../domain/code";
import { MAX_CODE_ATTEMPTS, writeImportedLink } from "./links-writer";

const ddbMock = mockClient(DynamoDBDocumentClient);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const IMPORT_ID = "3f1c2a9e-8b4d-4c6e-9a7f-1b2c3d4e5f60";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const ROW = { importId: IMPORT_ID, row: 4, url: "https://example.com/a", now: NOW };

// What DynamoDB throws when attribute_not_exists(code) fails; with ALL_OLD it carries the
// existing item (raw attribute values: the document client doesn't unmarshal errors).
function codeTakenBy(importId?: string, url = "https://other.example/"): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    message: "The conditional request failed",
    $metadata: {},
    Item: { code: { S: "x" }, url: { S: url }, ...(importId ? { importId: { S: importId } } : {}) },
  });
}

const putInputs = () => ddbMock.commandCalls(PutCommand).map((c) => c.args[0].input);

beforeEach(() => ddbMock.reset());

describe("writeImportedLink", () => {
  it("creates the link under the row's attempt-0 code, only if the code is free", async () => {
    ddbMock.on(PutCommand).resolves({});

    await expect(writeImportedLink(ddb, "links", ROW)).resolves.toBe("created");

    expect(putInputs()).toHaveLength(1);
    expect(putInputs()[0]).toMatchObject({
      TableName: "links",
      Item: { code: deterministicCode(IMPORT_ID, 4, 0), url: ROW.url, clicks: 0, importId: IMPORT_ID },
      ConditionExpression: "attribute_not_exists(code)",
      ReturnValuesOnConditionCheckFailure: "ALL_OLD",
    });
  });

  it("recognises its own link from an earlier delivery and writes nothing", async () => {
    ddbMock.on(PutCommand).rejects(codeTakenBy(IMPORT_ID, ROW.url));

    await expect(writeImportedLink(ddb, "links", ROW)).resolves.toBe("already-imported");

    expect(putInputs()).toHaveLength(1);
  });

  it("treats the same import's link for a different URL as taken (two rows can't share a code)", async () => {
    ddbMock.on(PutCommand).rejectsOnce(codeTakenBy(IMPORT_ID, "https://another-row.example/")).resolves({});

    await expect(writeImportedLink(ddb, "links", ROW)).resolves.toBe("created");

    expect(putInputs()).toHaveLength(2);
  });

  it("moves to the next attempt's code when the code belongs to someone else's link", async () => {
    ddbMock.on(PutCommand).rejectsOnce(codeTakenBy()).resolves({});

    await expect(writeImportedLink(ddb, "links", ROW)).resolves.toBe("created");

    expect(putInputs().map((i) => i?.Item?.code)).toStrictEqual([
      deterministicCode(IMPORT_ID, 4, 0),
      deterministicCode(IMPORT_ID, 4, 1),
    ]);
  });

  it("treats another import's link on the same code as someone else's", async () => {
    ddbMock.on(PutCommand).rejectsOnce(codeTakenBy("0b7e4c1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d")).resolves({});

    await expect(writeImportedLink(ddb, "links", ROW)).resolves.toBe("created");
  });

  it(`gives up as a collision after ${MAX_CODE_ATTEMPTS} attempts, never overwriting`, async () => {
    ddbMock.on(PutCommand).rejects(codeTakenBy());

    await expect(writeImportedLink(ddb, "links", ROW)).resolves.toBe("collision");

    expect(putInputs()).toHaveLength(MAX_CODE_ATTEMPTS);
    expect(putInputs().every((i) => i?.ConditionExpression === "attribute_not_exists(code)")).toBe(true);
  });

  it("rethrows other errors so the message is retried", async () => {
    ddbMock.on(PutCommand).rejects(new Error("ProvisionedThroughputExceededException"));

    await expect(writeImportedLink(ddb, "links", ROW)).rejects.toThrow("ProvisionedThroughputExceededException");
  });
});

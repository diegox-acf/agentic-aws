import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { PresignedPost } from "@aws-sdk/s3-presigned-post";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_TTL_SECONDS, type ImportRecord } from "../domain/imports";
import { makeHandler, type PresignDeps } from "./handler";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const IMPORT_ID = "3f1c2a9e-8b4d-4c6e-9a7f-1b2c3d4e5f60";
const CONFIG = {
  importsTable: "agentic-aws-dev-imports",
  bucketName: "agentic-aws-dev-imports-111111111111",
  urlTtlSeconds: 300,
  maxUploadBytes: 1_048_576,
};
const PRESIGNED: PresignedPost = {
  url: "https://agentic-aws-dev-imports-111111111111.s3.us-east-1.amazonaws.com/",
  fields: { key: `incoming/${IMPORT_ID}.csv`, "Content-Type": "text/csv", Policy: "eyJ...", "X-Amz-Signature": "abc" },
};

const ddbMock = mockClient(DynamoDBDocumentClient);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

type Log = PresignDeps["logger"];

let presignPost: ReturnType<typeof vi.fn<PresignDeps["presignPost"]>>;
let logger: { info: ReturnType<typeof vi.fn<Log["info"]>>; warn: ReturnType<typeof vi.fn<Log["warn"]>>; error: ReturnType<typeof vi.fn<Log["error"]>> };
let deps: PresignDeps;

function event(routeKey: string, pathParameters?: Record<string, string>): APIGatewayProxyEventV2 {
  // Only the fields the handler may read; the rest of the HTTP API v2 payload is irrelevant here.
  return { routeKey, pathParameters, rawPath: "/imports", headers: {}, isBase64Encoded: false } as unknown as APIGatewayProxyEventV2;
}

function expectJson(response: APIGatewayProxyStructuredResultV2, status: number): unknown {
  expect(response.statusCode).toBe(status);
  const contentType = Object.entries(response.headers ?? {}).find(([k]) => k.toLowerCase() === "content-type")?.[1];
  expect(String(contentType)).toMatch(/^application\/json/);
  return JSON.parse(response.body ?? "");
}

beforeEach(() => {
  ddbMock.reset();
  presignPost = vi.fn<PresignDeps["presignPost"]>().mockResolvedValue(PRESIGNED);
  logger = { info: vi.fn<Log["info"]>(), warn: vi.fn<Log["warn"]>(), error: vi.fn<Log["error"]>() };
  deps = { ddb, presignPost, clock: () => NOW, newId: () => IMPORT_ID, logger, config: CONFIG };
});

afterEach(() => vi.restoreAllMocks());

describe("POST /imports", () => {
  it("answers 201 with the importId and the presigned upload", async () => {
    ddbMock.on(PutCommand).resolves({});

    const response = await makeHandler(deps)(event("POST /imports"));

    expect(expectJson(response, 201)).toStrictEqual({ importId: IMPORT_ID, upload: PRESIGNED });
  });

  it("creates a PENDING record that expires in 30 days, only if the id is new", async () => {
    ddbMock.on(PutCommand).resolves({});

    await makeHandler(deps)(event("POST /imports"));

    const puts = ddbMock.commandCalls(PutCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.args[0].input).toMatchObject({
      TableName: CONFIG.importsTable,
      Item: {
        importId: IMPORT_ID,
        status: "PENDING",
        createdAt: NOW.toISOString(),
        expiresAt: NOW_SECONDS + IMPORT_TTL_SECONDS,
      } satisfies ImportRecord,
      ConditionExpression: "attribute_not_exists(importId)",
    });
  });

  it("presigns a POST for incoming/<id>.csv that S3 limits to 1 MB of text/csv", async () => {
    ddbMock.on(PutCommand).resolves({});

    await makeHandler(deps)(event("POST /imports"));

    expect(presignPost).toHaveBeenCalledTimes(1);
    const options = presignPost.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      Bucket: CONFIG.bucketName,
      Key: `incoming/${IMPORT_ID}.csv`,
      Expires: CONFIG.urlTtlSeconds,
      Fields: { "Content-Type": "text/csv" },
    });
    expect(options?.Conditions).toEqual(
      expect.arrayContaining([
        ["content-length-range", 1, CONFIG.maxUploadBytes],
        ["eq", "$Content-Type", "text/csv"],
      ]),
    );
  });

  it("answers a generic 500 and presigns nothing when the record can't be written", async () => {
    ddbMock.on(PutCommand).rejects(new Error("ProvisionedThroughputExceededException: secret detail"));

    const response = await makeHandler(deps)(event("POST /imports"));

    expectJson(response, 500);
    expect(response.body).not.toContain("secret detail");
    expect(presignPost).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("answers a generic 500 when presigning fails", async () => {
    ddbMock.on(PutCommand).resolves({});
    presignPost.mockRejectedValue(new Error("CredentialsProviderError: secret detail"));

    const response = await makeHandler(deps)(event("POST /imports"));

    expectJson(response, 500);
    expect(response.body).not.toContain("secret detail");
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("GET /imports/{importId}", () => {
  const stored: ImportRecord = {
    importId: IMPORT_ID,
    status: "PENDING",
    createdAt: "2026-10-26T11:59:00.000Z",
    expiresAt: NOW_SECONDS + 60,
  };

  it("answers 200 with the import's public view", async () => {
    ddbMock.on(GetCommand).resolves({ Item: stored });

    const response = await makeHandler(deps)(event("GET /imports/{importId}", { importId: IMPORT_ID }));

    expect(expectJson(response, 200)).toStrictEqual({
      importId: IMPORT_ID,
      status: "PENDING",
      createdAt: stored.createdAt,
    });
  });

  it("reads with ConsistentRead, because the importer may have just updated the record", async () => {
    ddbMock.on(GetCommand).resolves({ Item: stored });

    await makeHandler(deps)(event("GET /imports/{importId}", { importId: IMPORT_ID }));

    expect(ddbMock.commandCalls(GetCommand)[0]?.args[0].input).toMatchObject({
      TableName: CONFIG.importsTable,
      Key: { importId: IMPORT_ID },
      ConsistentRead: true,
    });
  });

  it("answers 404 for an unknown import", async () => {
    ddbMock.on(GetCommand).resolves({});

    const response = await makeHandler(deps)(event("GET /imports/{importId}", { importId: IMPORT_ID }));

    expectJson(response, 404);
  });

  it("answers 404 for an expired import that TTL hasn't deleted yet", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...stored, expiresAt: NOW_SECONDS - 1 } });

    const response = await makeHandler(deps)(event("GET /imports/{importId}", { importId: IMPORT_ID }));

    expectJson(response, 404);
  });

  it.each(["not-a-uuid", "3F1C2A9E-8B4D-4C6E-9A7F-1B2C3D4E5F60x", ""])(
    "answers 404 for importId %j without calling DynamoDB",
    async (importId) => {
      const response = await makeHandler(deps)(event("GET /imports/{importId}", { importId }));

      expectJson(response, 404);
      expect(ddbMock.calls()).toHaveLength(0);
    },
  );

  it("answers a generic 500 when DynamoDB fails", async () => {
    ddbMock.on(GetCommand).rejects(new Error("InternalServerError: secret detail"));

    const response = await makeHandler(deps)(event("GET /imports/{importId}", { importId: IMPORT_ID }));

    expectJson(response, 500);
    expect(response.body).not.toContain("secret detail");
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("other routes", () => {
  it("answers 404 for a route this function doesn't serve", async () => {
    const response = await makeHandler(deps)(event("DELETE /imports/{importId}", { importId: IMPORT_ID }));

    expectJson(response, 404);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

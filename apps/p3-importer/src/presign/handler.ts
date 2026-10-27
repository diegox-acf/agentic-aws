import type { Logger } from "@aws-lambda-powertools/logger";
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { PresignedPost, PresignedPostOptions } from "@aws-sdk/s3-presigned-post";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { IMPORT_TTL_SECONDS, isImportId, type ImportRecord } from "../domain/imports";
import type { PresignConfig } from "../shared/config";
import { toView } from "./view";

/**
 * Everything the handler talks to, injected so tests can replace AWS. index.ts wires the real
 * clients: presignPost is createPresignedPost bound to an S3Client.
 */
export interface PresignDeps {
  ddb: DynamoDBDocumentClient;
  presignPost: (options: PresignedPostOptions) => Promise<PresignedPost>;
  clock: () => Date;
  newId: () => string; // crypto.randomUUID in production
  logger: Pick<Logger, "info" | "warn" | "error">;
  config: PresignConfig;
}

/** POST /imports response body. The client sends `fields` as form fields, then the file, to `url`. */
export interface CreateImportResponse {
  importId: string;
  upload: PresignedPost;
}

export type PresignHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;

const CSV = "text/csv";

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const notFound = (): APIGatewayProxyStructuredResultV2 => json(404, { message: "not found" });

/**
 * Serves both routes of the presign function (see handler.test.ts for the contract):
 *
 * POST /imports
 *   1. PutCommand into config.importsTable: { importId, status: "PENDING", createdAt, expiresAt },
 *      only if the importId doesn't exist yet (ConditionExpression).
 *   2. presignPost for key incoming/<importId>.csv, Expires = config.urlTtlSeconds, with policy
 *      conditions S3 enforces at upload: ["content-length-range", 1, config.maxUploadBytes] and
 *      ["eq", "$Content-Type", "text/csv"]; Fields { "Content-Type": "text/csv" }.
 *   3. 201 with CreateImportResponse.
 *
 * GET /imports/{importId}
 *   Not a UUID -> 404 without calling DynamoDB. GetCommand with ConsistentRead (the importer may
 *   have just updated it). Missing, or toView() returns null (expired) -> 404. Else 200 + view.
 *
 * Any other route -> 404. AWS errors -> log with deps.logger.error, answer a generic 500 that
 * doesn't leak the error. Every response is JSON (content-type application/json).
 */
export function makeHandler(deps: PresignDeps): PresignHandler {
  const { ddb, presignPost, clock, newId, logger, config } = deps;

  async function createImport(): Promise<APIGatewayProxyStructuredResultV2> {
    const now = clock();
    const importId = newId();
    const record: ImportRecord = {
      importId,
      status: "PENDING",
      createdAt: now.toISOString(),
      expiresAt: Math.floor(now.getTime() / 1000) + IMPORT_TTL_SECONDS,
    };

    // Record first: an upload URL must never exist for an import the importer can't find.
    await ddb.send(
      new PutCommand({
        TableName: config.importsTable,
        Item: record,
        ConditionExpression: "attribute_not_exists(importId)",
      }),
    );

    // The policy is signed with this function's credentials; S3 rejects any upload that breaks it.
    const upload = await presignPost({
      Bucket: config.bucketName,
      Key: `incoming/${importId}.csv`,
      Expires: config.urlTtlSeconds,
      Fields: { "Content-Type": CSV },
      Conditions: [
        ["content-length-range", 1, config.maxUploadBytes],
        ["eq", "$Content-Type", CSV],
      ],
    });

    logger.info("import created", { importId });
    const body: CreateImportResponse = { importId, upload };
    return json(201, body);
  }

  async function getImport(importId: string | undefined): Promise<APIGatewayProxyStructuredResultV2> {
    // Anything that isn't one of our ids is a 404 without spending a DynamoDB read.
    if (importId === undefined || !isImportId(importId)) {
      return notFound();
    }
    const { Item } = await ddb.send(
      new GetCommand({ TableName: config.importsTable, Key: { importId }, ConsistentRead: true }),
    );
    // Our own table, written only by presign and the importer, so the item has ImportRecord's shape.
    const view = Item === undefined ? null : toView(Item as ImportRecord, clock());
    return view === null ? notFound() : json(200, view);
  }

  return async (event) => {
    try {
      switch (event.routeKey) {
        case "POST /imports":
          return await createImport();
        case "GET /imports/{importId}":
          return await getImport(event.pathParameters?.importId);
        default:
          return notFound();
      }
    } catch (error) {
      // Details go to the log (and trip the ERROR-log alarm); the caller learns nothing internal.
      logger.error("request failed", error instanceof Error ? error : String(error));
      return json(500, { message: "internal error" });
    }
  };
}

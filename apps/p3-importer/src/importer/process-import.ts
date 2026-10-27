import { Readable } from "node:stream";
import type { Logger } from "@aws-lambda-powertools/logger";
import { GetObjectCommand, NoSuchKey, type S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CsvError } from "csv-parse";
import type { ImportSummary } from "../domain/imports";
import type { ImportObject } from "../domain/s3-event";
import { isValidUrl } from "../domain/url";
import type { ImporterConfig } from "../shared/importer-config";
import { readUrlRows } from "./csv";
import { importsRepo } from "./imports-repo";
import { writeImportedLink } from "./links-writer";

export interface ProcessDeps {
  ddb: DynamoDBDocumentClient;
  s3: S3Client;
  clock: () => Date;
  logger: Pick<Logger, "info" | "warn" | "error">;
  config: ImporterConfig;
}

type Outcome = Omit<ImportSummary, "importId">;

/**
 * Imports one uploaded file. Returns the summary to announce, or undefined when there is nothing
 * to announce (no record, already announced, or another delivery finished it).
 *
 * Permanent problems (too large, too many rows, file gone, unparseable CSV) finish the import as
 * FAILED; a retry couldn't fix them. Rows are written while the file streams, so a FAILED import
 * can be partial: `created` counts the links that exist. Anything else is thrown, the import stays
 * PROCESSING, and SQS redelivers the message: safe, because every row maps to the same codes (ADR 0004).
 */
export async function processImport(deps: ProcessDeps, object: ImportObject): Promise<ImportSummary | undefined> {
  const { ddb, clock, logger, config } = deps;
  const { importId } = object;
  const repo = importsRepo(ddb, config.importsTable);

  // IAM already limits reads to our bucket; refusing other buckets here keeps a forged message
  // from even touching an import record.
  if (object.bucket !== config.bucketName) {
    logger.error("message is about another bucket, ignoring it", { importId, bucket: object.bucket });
    return undefined;
  }

  const start = await repo.start(importId, clock());
  if (start.outcome === "missing") {
    // Presign writes the record before it signs an upload, so this is not one of our uploads.
    logger.error("upload has no import record", { importId, key: object.key });
    return undefined;
  }
  if (start.outcome === "finished") {
    if (start.notified) {
      logger.info("import already finished, skipping", { importId });
      return undefined;
    }
    return start.summary; // finished, but the announcement failed last time
  }

  const summary: ImportSummary = { importId, ...(await importRows(deps, object)) };
  if (!(await repo.finish(summary, clock()))) {
    logger.info("another delivery finished this import", { importId });
    return undefined;
  }
  logger.info("import finished", { ...summary });
  return summary;
}

async function importRows(deps: ProcessDeps, object: ImportObject): Promise<Outcome> {
  const { ddb, s3, clock, config } = deps;
  const failed = (error: string, created = 0, rejected = 0): Outcome => ({ status: "FAILED", created, rejected, error });

  // The size is in the event: an oversized file is refused before a single byte is downloaded.
  if (object.size > config.maxUploadBytes) {
    return failed(`file larger than ${config.maxUploadBytes} bytes`);
  }

  let body: Readable;
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: config.bucketName, Key: object.key }));
    // In Node.js the SDK returns the body as a Readable stream; anything else is a bug, not data.
    if (!(response.Body instanceof Readable)) {
      throw new Error(`GetObject returned no readable body for ${object.key}`);
    }
    body = response.Body;
  } catch (error) {
    if (error instanceof NoSuchKey) {
      return failed("uploaded file not found");
    }
    throw error;
  }

  let created = 0;
  let rejected = 0;
  let batch: { row: number; url: string }[] = [];
  const flush = async (): Promise<void> => {
    const outcomes = await Promise.all(
      batch.map(({ row, url }) => writeImportedLink(ddb, config.linksTable, { importId: object.importId, row, url, now: clock() })),
    );
    batch = [];
    for (const outcome of outcomes) {
      if (outcome === "collision") {
        rejected++;
      } else {
        created++; // "already-imported" counts too: the row's link exists, from an earlier delivery
      }
    }
  };

  try {
    for await (const row of readUrlRows(body)) {
      if (row.row > config.maxRows) {
        return failed(`more than ${config.maxRows} rows`, created, rejected); // stops the download too
      }
      if ("error" in row || !isValidUrl(row.url)) {
        rejected++;
        continue;
      }
      batch.push(row);
      if (batch.length >= config.writeConcurrency) {
        await flush(); // at most writeConcurrency PutItems in flight
      }
    }
    await flush();
  } catch (error) {
    if (error instanceof CsvError) {
      return failed(`invalid CSV: ${error.message}`, created, rejected);
    }
    throw error;
  }
  return { status: "DONE", created, rejected };
}

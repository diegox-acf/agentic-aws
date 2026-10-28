import { BatchProcessor, EventType, processPartialResponse } from "@aws-lambda-powertools/batch";
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { parseImportEvent, type ImportObject } from "../domain/s3-event";
import { importsRepo } from "./imports-repo";
import type { Notify } from "./notify";
import { processImport, type ProcessDeps } from "./process-import";

export interface ImporterDeps extends ProcessDeps {
  notify: Notify;
}

export type ImporterHandler = (event: SQSEvent, context: Context) => Promise<SQSBatchResponse>;

/**
 * SQS -> importer. Each record is one uploaded file. A record that throws is reported in
 * batchItemFailures (the event source mapping has ReportBatchItemFailures), so SQS retries only
 * that message and, after maxReceiveCount failures, moves it to the DLQ.
 * When every record fails, the processor throws instead: the invocation counts as an error.
 *
 * Powertools logs nothing about a failed record, and Lambda logs only the processor's "All records
 * failed processing" wrapper, so every failed attempt is logged here with its cause.
 */
export function makeImporterHandler(deps: ImporterDeps): ImporterHandler {
  const processor = new BatchProcessor(EventType.SQS);
  const repo = importsRepo(deps.ddb, deps.config.importsTable);

  async function recordHandler(record: SQSRecord): Promise<void> {
    let object;
    try {
      object = parseImportEvent(record.body);
    } catch (error) {
      // Not retryable, but kept: after its retries it waits in the DLQ for a human to inspect.
      deps.logger.error("unrecognized message", { messageId: record.messageId, error });
      throw error;
    }

    try {
      await importAndAnnounce(object);
    } catch (error) {
      await reportFailedAttempt(record, object.importId, error);
      throw error; // without it the message counts as processed and SQS deletes it
    }
  }

  async function importAndAnnounce(object: ImportObject): Promise<void> {
    const summary = await processImport(deps, object);
    if (summary === undefined) {
      return;
    }
    // Announce, then remember it. If SNS fails, notified stays unset and the retry announces it.
    await deps.notify(summary);
    await repo.markNotified(summary.importId);
  }

  // On the last delivery SQS gives up next (the message moves to the DLQ), and nothing else would
  // ever finish the import: it would stay PROCESSING and look slow, not dead. A run that times out
  // never gets here; that case is M6's.
  async function reportFailedAttempt(record: SQSRecord, importId: string, error: unknown): Promise<void> {
    const receiveCount = record.attributes.ApproximateReceiveCount;
    // The Error itself, not String(error): the logger keeps its name and stack.
    deps.logger.error("import attempt failed", { importId, messageId: record.messageId, receiveCount, error });
    // Written so a missing count (NaN) means "not the last delivery", never "give up now".
    if (!(Number(receiveCount) >= deps.config.maxReceiveCount)) {
      return;
    }
    // GET shows the reason to anyone, and SDK messages can name roles or the account: the
    // details stay in the log line above.
    const reason = `gave up after ${receiveCount} deliveries; see the importer logs`;
    try {
      if (await repo.giveUp(importId, reason, deps.clock())) {
        deps.logger.warn("import marked FAILED, its message goes to the DLQ", { importId });
      }
    } catch (giveUpError) {
      // Don't replace the original error: it's the one that explains the failure.
      deps.logger.error("could not mark the import FAILED", { importId, error: giveUpError });
    }
  }

  return (event, context) => processPartialResponse(event, recordHandler, processor, { context });
}

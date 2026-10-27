import { BatchProcessor, EventType, processPartialResponse } from "@aws-lambda-powertools/batch";
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { parseImportEvent } from "../domain/s3-event";
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
      deps.logger.error("unrecognized message", { messageId: record.messageId, error: String(error) });
      throw error;
    }

    const summary = await processImport(deps, object);
    if (summary === undefined) {
      return;
    }
    // Announce, then remember it. If SNS fails, notified stays unset and the retry announces it.
    await deps.notify(summary);
    await repo.markNotified(summary.importId);
  }

  return (event, context) => processPartialResponse(event, recordHandler, processor, { context });
}

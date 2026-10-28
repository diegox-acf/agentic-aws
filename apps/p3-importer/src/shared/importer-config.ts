import { z } from "zod";

// Validated once at cold start, like the presign config: a misconfigured importer fails its first
// invocation, the message is retried and ends in the DLQ instead of being half-processed.
const importerEnv = z.object({
  LINKS_TABLE: z.string().min(1),
  IMPORTS_TABLE: z.string().min(1),
  BUCKET_NAME: z.string().min(1), // the only bucket it reads, whatever a message claims
  RESULTS_TOPIC_ARN: z.string().regex(/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/, "must be an SNS topic ARN"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).default(1_048_576),
  // The API is unauthenticated: without a cap, one 1 MB file of short URLs is ~80,000 writes.
  MAX_ROWS: z.coerce.number().int().min(1).default(1000),
  // Conditional PutItems in flight at once. 25 matches what one BatchWriteItem would carry.
  WRITE_CONCURRENCY: z.coerce.number().int().min(1).max(25).default(10),
  // The queue's maxReceiveCount: on that delivery the importer marks the import FAILED. No default,
  // so it can't silently disagree with the queue (p3.hcl sets both).
  MAX_RECEIVE_COUNT: z.coerce.number().int().min(1).max(1000),
});

export interface ImporterConfig {
  linksTable: string;
  importsTable: string;
  bucketName: string;
  resultsTopicArn: string;
  maxUploadBytes: number;
  maxRows: number;
  writeConcurrency: number;
  maxReceiveCount: number;
}

export function loadImporterConfig(env: Record<string, string | undefined>): ImporterConfig {
  const parsed = importerEnv.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid importer configuration: ${problems}`);
  }
  const values = parsed.data;
  return {
    linksTable: values.LINKS_TABLE,
    importsTable: values.IMPORTS_TABLE,
    bucketName: values.BUCKET_NAME,
    resultsTopicArn: values.RESULTS_TOPIC_ARN,
    maxUploadBytes: values.MAX_UPLOAD_BYTES,
    maxRows: values.MAX_ROWS,
    writeConcurrency: values.WRITE_CONCURRENCY,
    maxReceiveCount: values.MAX_RECEIVE_COUNT,
  };
}

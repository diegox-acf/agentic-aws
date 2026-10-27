// The imports table: one item per bulk import, keyed by importId.

export type ImportStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

/** How long an import record stays around, like P1's links. */
export const IMPORT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** What crypto.randomUUID produces (lowercase v4): the only shape an importId can have. */
export const IMPORT_ID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const IMPORT_ID = new RegExp(`^${IMPORT_ID_PATTERN}$`);

export function isImportId(value: string): boolean {
  return IMPORT_ID.test(value);
}

/** The item as stored in DynamoDB. */
export interface ImportRecord {
  importId: string; // UUID, the hash key
  status: ImportStatus;
  createdAt: string; // RFC 3339
  expiresAt: number; // unix seconds; the table's TTL attribute
  created?: number; // links written (set when the importer finishes)
  rejected?: number; // rows rejected (invalid URL, collision)
  finishedAt?: string; // RFC 3339
  error?: string; // why the file couldn't be processed (status FAILED)
  // Internal bookkeeping, never shown by GET:
  attempts?: number; // importer runs that started this import (redeliveries included)
  startedAt?: string; // RFC 3339, the latest run's start
  notified?: boolean; // the results summary was published (set after SNS accepts it)
}

/** How a finished import ended, as the importer records and announces it. */
export interface ImportSummary {
  importId: string;
  status: Extract<ImportStatus, "DONE" | "FAILED">;
  created: number;
  rejected: number;
  error?: string;
}

/** What GET /imports/{importId} returns: the record without storage details like the TTL. */
export interface ImportView {
  importId: string;
  status: ImportStatus;
  createdAt: string;
  created?: number;
  rejected?: number;
  finishedAt?: string;
  error?: string;
}

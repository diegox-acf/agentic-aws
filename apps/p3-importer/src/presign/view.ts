import type { ImportRecord, ImportView } from "../domain/imports";

/**
 * Turns a stored record into the GET /imports/{importId} body, or null if it has expired.
 *
 * DynamoDB TTL deletes expired items lazily (often within days, not at expiresAt), so an expired
 * record can still come back from GetItem. Treat expiresAt <= now as gone, like P1's links.
 * The view omits storage details (expiresAt) and includes the optional fields only when set.
 */
export function toView(record: ImportRecord, now: Date): ImportView | null {
  if (record.expiresAt <= now.getTime() / 1000) {
    return null;
  }
  const { importId, status, createdAt, created, rejected, finishedAt, error } = record;
  return {
    importId,
    status,
    createdAt,
    ...(created === undefined ? {} : { created }),
    ...(rejected === undefined ? {} : { rejected }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(error === undefined ? {} : { error }),
  };
}

// An item in P1's links table, written by the importer. P1's Go store reads these, so the shape
// must match apps/p1-shortener/internal/store/dynamo.go; P1 ignores the extra importId attribute.

/** P1's links TTL (links.TTL in Go): 30 days. */
export const LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface LinkItem {
  code: string; // hash key, 7 base62 characters
  url: string;
  clicks: number;
  createdAt: string; // RFC 3339, how Go's attributevalue stores a time.Time
  expiresAt: number; // unix seconds, the table's TTL attribute
  importId: string; // which import wrote it: how a redelivery recognises its own rows
}

export interface NewLink {
  code: string;
  url: string;
  importId: string;
  now: Date;
}

export function toLinkItem({ code, url, importId, now }: NewLink): LinkItem {
  return {
    code,
    url,
    clicks: 0,
    createdAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + LINK_TTL_SECONDS,
    importId,
  };
}

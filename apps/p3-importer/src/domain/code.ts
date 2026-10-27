import { createHash } from "node:crypto";

// Same shape as P1's codes (apps/p1-shortener/internal/links/code.go): 7 base62 characters, so
// P1's ValidCode accepts them and GET /{code} resolves them.
export const CODE_LENGTH = 7;
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// The largest multiple of 62 that fits in a byte (4 * 62 = 248). Bytes at or above it are skipped:
// keeping them would make b % 62 favour the first 8 characters.
const REJECT_FROM = 248;

/**
 * The code for row `row` of import `importId`, on try `attempt` (0, then 1, 2 after collisions
 * with someone else's link). Deterministic, so a redelivered file maps every row to the code it
 * got the first time, and a re-run can recognise its own writes instead of duplicating them.
 */
export function deterministicCode(importId: string, row: number, attempt: number): string {
  const seed = `${importId}:${row}:${attempt}`;
  let code = "";
  // One SHA-256 digest (32 bytes, each kept with probability 248/256) virtually always yields
  // 7 characters; further blocks only exist so the loop can't come up short.
  for (let block = 0; code.length < CODE_LENGTH; block++) {
    const digest = createHash("sha256").update(block === 0 ? seed : `${seed}:${block}`).digest();
    for (const byte of digest) {
      if (byte >= REJECT_FROM) {
        continue;
      }
      code += ALPHABET.charAt(byte % ALPHABET.length);
      if (code.length === CODE_LENGTH) {
        break;
      }
    }
  }
  return code;
}

const VALID_CODE = new RegExp(`^[0-9A-Za-z]{${CODE_LENGTH}}$`);

/** The shape check P1's ValidCode performs. */
export function isValidCode(code: string): boolean {
  return VALID_CODE.test(code);
}

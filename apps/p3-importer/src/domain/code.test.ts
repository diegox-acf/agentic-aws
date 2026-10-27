import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CODE_LENGTH, deterministicCode, isValidCode } from "./code";

const IMPORT_ID = "3f1c2a9e-8b4d-4c6e-9a7f-1b2c3d4e5f60";

describe("deterministicCode", () => {
  it("returns the same code for the same import, row and attempt (so a re-run rewrites nothing new)", () => {
    expect(deterministicCode(IMPORT_ID, 1, 0)).toBe(deterministicCode(IMPORT_ID, 1, 0));
  });

  it("returns a 7-character base62 code, the shape P1's ValidCode accepts", () => {
    for (let row = 1; row <= 500; row++) {
      const code = deterministicCode(IMPORT_ID, row, 0);
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isValidCode(code)).toBe(true);
    }
  });

  it("differs by row, by attempt and by import", () => {
    const base = deterministicCode(IMPORT_ID, 1, 0);
    expect(deterministicCode(IMPORT_ID, 2, 0)).not.toBe(base);
    expect(deterministicCode(IMPORT_ID, 1, 1)).not.toBe(base);
    expect(deterministicCode("0b7e4c1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d", 1, 0)).not.toBe(base);
  });

  it("is derived from SHA-256 of '<importId>:<row>:<attempt>' with P1's rejection sampling", () => {
    // Golden vector, recomputed independently: keep bytes < 248, map b % 62 onto P1's alphabet.
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const digest = createHash("sha256").update(`${IMPORT_ID}:7:2`).digest();
    const expected = [...digest]
      .filter((b) => b < 248)
      .slice(0, CODE_LENGTH)
      .map((b) => alphabet[b % 62])
      .join("");

    expect(deterministicCode(IMPORT_ID, 7, 2)).toBe(expected);
  });

  it("produces no duplicate codes across 10,000 rows of one import", () => {
    const codes = new Set<string>();
    for (let row = 1; row <= 10_000; row++) {
      codes.add(deterministicCode(IMPORT_ID, row, 0));
    }
    expect(codes.size).toBe(10_000);
  });
});

describe("isValidCode", () => {
  it.each(["abc1234", "ZZZZZZZ", "0000000"])("accepts %s", (code) => {
    expect(isValidCode(code)).toBe(true);
  });

  it.each(["abc123", "abc12345", "abc-123", "abc 123", "ábc1234"])("rejects %j", (code) => {
    expect(isValidCode(code)).toBe(false);
  });
});

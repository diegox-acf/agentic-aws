import { describe, expect, it } from "vitest";

import { isValidCode, MAX_URL_BYTES, validateUrl } from "./validation";

// Mirrors TestServiceCreate_ValidatesURL in apps/p1-shortener/internal/links/service_test.go.
// The server stays authoritative; this only spares a round trip for obvious mistakes.
describe("validateUrl", () => {
  const prefix = "https://example.com/";

  it.each([
    ["valid https", "https://aws.amazon.com/lambda/"],
    ["valid http", "http://example.com"],
    ["uppercase scheme", "HTTPS://Example.com/Path"],
    ["exactly 2048 bytes", prefix + "a".repeat(MAX_URL_BYTES - prefix.length)],
    ["surrounding whitespace is ignored", "  https://example.com  "],
  ])("accepts %s", (_, url) => {
    expect(validateUrl(url)).toEqual({ ok: true, url: url.trim() });
  });

  it.each([
    ["empty", "", /enter a url/i],
    ["only spaces", "   ", /enter a url/i],
    ["2049 bytes", prefix + "a".repeat(MAX_URL_BYTES + 1 - prefix.length), /2048/],
    ["2049 bytes of multi-byte characters", prefix + "é".repeat(1015), /2048/],
    ["ftp", "ftp://example.com/file", /http:\/\/ or https:\/\//],
    ["javascript", "javascript:alert(1)", /http:\/\/ or https:\/\//],
    ["data", "data:text/html,<script>alert(1)</script>", /http:\/\/ or https:\/\//],
    ["no scheme", "example.com/path", /http:\/\/ or https:\/\//],
    // The browser's URL parser accepts these two (it invents a host); Go's does not.
    ["missing host", "https:///path", /http:\/\/ or https:\/\//],
    ["opaque, no slashes", "https:example.com", /http:\/\/ or https:\/\//],
    ["unparseable", "https://exa mple.com/%zz", /not a valid url/i],
    ["port but no hostname", "http://:80/", /not a valid url/i],
    ["userinfo disguises the host", "https://good.com@evil.com/", /username or password/i],
    ["user and password", "https://user:pass@example.com/", /username or password/i],
  ])("rejects %s", (_, url, message) => {
    const result = validateUrl(url);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(message);
  });
});

describe("isValidCode", () => {
  it.each(["aB3xY9z", "0000000", "zzzzzzz"])("accepts %s", (code) => {
    expect(isValidCode(code)).toBe(true);
  });

  it.each(["", "aB3xY9", "aB3xY9zz", "aB3-Y9z", "aB3xY9 ", "../link"])("rejects %j", (code) => {
    expect(isValidCode(code)).toBe(false);
  });
});

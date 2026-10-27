import { describe, expect, it } from "vitest";
import { isValidUrl, MAX_URL_BYTES } from "./url";

// The cases from P1's validateURL tests (apps/p1-shortener/internal/links/service_test.go), so an
// imported link is accepted or rejected exactly like one created through POST /links.
const prefix = "https://example.com/";

describe("isValidUrl, parity with P1", () => {
  it.each([
    ["valid https", "https://aws.amazon.com/lambda/"],
    ["valid http", "http://example.com"],
    ["uppercase scheme", "HTTPS://Example.com/Path"],
    ["exactly 2048 bytes", prefix + "a".repeat(MAX_URL_BYTES - prefix.length)],
  ])("accepts %s", (_name, url) => {
    expect(isValidUrl(url)).toBe(true);
  });

  it.each([
    ["2049 bytes", prefix + "a".repeat(MAX_URL_BYTES + 1 - prefix.length)],
    ["empty", ""],
    ["ftp", "ftp://example.com/file"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["missing host", "https:///path"],
    ["opaque, no host", "https:example.com"],
    ["no scheme", "example.com/path"],
    ["unparseable", "https://exa mple.com/%zz"],
    ["userinfo disguises the host", "https://good.com@evil.com/"],
    ["user and password", "https://user:pass@example.com/"],
    ["port but no hostname", "http://:80/"],
  ])("rejects %s", (_name, url) => {
    expect(isValidUrl(url)).toBe(false);
  });
});

// WHATWG URL (Node's URL) is more forgiving than Go's url.Parse; these are the gaps.
describe("isValidUrl, where WHATWG URL would accept what Go rejects", () => {
  it.each([
    ["an invalid percent escape", "https://example.com/%zz"],
    ["a space in the host", "https://exa mple.com/"],
    ["a backslash", "https://example.com\\evil.com"],
    ["a control character", "https://example.com/\u0007"],
    ["leading whitespace", " https://example.com/"],
    ["a single slash after the scheme", "https:/example.com"],
  ])("rejects %s", (_name, url) => {
    expect(isValidUrl(url)).toBe(false);
  });

  it("counts bytes, not characters: 2048 bytes of multibyte text is the limit", () => {
    const twoByteChars = (MAX_URL_BYTES - prefix.length) / 2; // "é" is 2 bytes in UTF-8
    expect(isValidUrl(prefix + "é".repeat(twoByteChars))).toBe(true);
    expect(isValidUrl(prefix + "é".repeat(twoByteChars) + "a")).toBe(false);
  });

  it.each([
    ["an empty username", "http://@x.com/"],
    ["an empty username and password", "http://:@x.com/"],
  ])("rejects %s (WHATWG reports no user, Go's User is non-nil)", (_name, url) => {
    expect(isValidUrl(url)).toBe(false);
  });

  it("accepts an @ in the path, which is not userinfo", () => {
    expect(isValidUrl("https://example.com/users/@diego")).toBe(true);
  });

  it("accepts a valid percent escape and a port", () => {
    expect(isValidUrl("https://example.com:8443/a%20b?q=%2F")).toBe(true);
  });
});

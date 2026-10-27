// URL rules shared with P1 (validateURL in apps/p1-shortener/internal/links/service.go): absolute
// http(s) URLs with a hostname and no userinfo, at most 2048 bytes. Everything P1 rejects is
// rejected here too (its test table runs in url.test.ts). Deliberately a little stricter: Go
// accepts spaces, other whitespace and "\" in the path, a bad "%" escape in the query and ports
// above 65535; an imported redirect target with any of those is refused.

export const MAX_URL_BYTES = 2048;

// Node's URL follows the WHATWG spec, which repairs input Go's url.Parse rejects: it accepts
// "https:example.com" and "https:///path" (taking "path" as the host), strips leading spaces,
// treats "\" like "/", lets "%zz" through, and reports "http://@x.com" as having no user at all
// (Go: an empty, non-nil User). These checks run first so those inputs fail as in P1.
const SCHEME_THEN_HOST = /^https?:\/\/[^/]/i;
const USERINFO = /^https?:\/\/[^/?#]*@/i; // any "@" before the path: userinfo, even if empty
const WHITESPACE_BACKSLASH_OR_CONTROL = /[\s\\\p{Cc}]/u;
const INVALID_PERCENT_ESCAPE = /%(?![0-9A-Fa-f]{2})/;

export function isValidUrl(raw: string): boolean {
  if (raw === "" || Buffer.byteLength(raw, "utf8") > MAX_URL_BYTES) {
    return false;
  }
  if (
    !SCHEME_THEN_HOST.test(raw) ||
    USERINFO.test(raw) ||
    WHITESPACE_BACKSLASH_OR_CONTROL.test(raw) ||
    INVALID_PERCENT_ESCAPE.test(raw)
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false; // e.g. "http://:80/": a port but no hostname
  }
  // Userinfo is rejected because "https://trusted.com@evil.com" reads like trusted.com but goes to evil.com.
  return url.hostname !== "" && url.username === "" && url.password === "";
}

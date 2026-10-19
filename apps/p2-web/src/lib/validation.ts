// Client-side copies of the server's rules (apps/p1-shortener/internal/links). They exist for
// fast feedback only; the API re-validates everything.

export const MAX_URL_BYTES = 2048; // links.maxURLBytes; the server counts bytes, not characters

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

// Go's url.Parse needs "scheme://host". The browser's URL parser is more lenient: it reads
// "https:example.com" and "https:///path" as having a host, so check the shape explicitly.
const SCHEME_AND_HOST = /^https?:\/\/[^/]/i;

export function validateUrl(input: string): UrlCheck {
  const url = input.trim();
  if (url === "") {
    return { ok: false, error: "Enter a URL to shorten." };
  }
  if (new TextEncoder().encode(url).length > MAX_URL_BYTES) {
    return { ok: false, error: `That URL is too long (max ${MAX_URL_BYTES} bytes).` };
  }
  if (!SCHEME_AND_HOST.test(url)) {
    return { ok: false, error: "Use a full URL starting with http:// or https://." };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }
  // "https://trusted.com@evil.com" reads like trusted.com but goes to evil.com.
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, error: "URLs with a username or password (user@host) are not allowed." };
  }
  return { ok: true, url };
}

const CODE = /^[0-9A-Za-z]{7}$/; // links.ValidCode: 7 base62 characters

export function isValidCode(code: string): boolean {
  return CODE.test(code);
}

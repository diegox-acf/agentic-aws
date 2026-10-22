import { z } from "zod";

import { apiBaseUrl } from "./config";
import { isHttpUrl, isValidCode } from "./validation";

// Response shapes of the P1 API (apps/p1-shortener/internal/httpapi/router.go). The body comes
// from the network, so it is parsed, not trusted: URLs land in hrefs and the code in a link.
const httpUrl = z.string().refine(isHttpUrl);
const shortLinkSchema = z.object({ code: z.string().refine(isValidCode), shortUrl: httpUrl });
const linkStatsSchema = z.object({ url: httpUrl, clicks: z.number(), createdAt: z.iso.datetime() });
const errorBodySchema = z.object({ error: z.string() });

export type ShortLink = z.infer<typeof shortLinkSchema>;
export type LinkStats = z.infer<typeof linkStatsSchema>;

const TIMEOUT_MS = 10_000; // the Lambda's own timeout; waiting longer cannot help

// status 0 means no HTTP response at all: network failure, CORS rejection or timeout.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createLink(url: string): Promise<ShortLink> {
  return request("/links", shortLinkSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export function getStats(code: string): Promise<LinkStats> {
  if (!isValidCode(code)) {
    // The API answers 404 for malformed codes too; skip the round trip.
    return Promise.reject(new ApiError(404, "not found"));
  }
  return request(`/links/${code}`, linkStatsSchema);
}

async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const base = apiBaseUrl(); // outside the try: a build without the API URL is not a network error
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: unknown) {
    // A browser reports a CORS rejection exactly like a network failure: a TypeError.
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new ApiError(0, timedOut ? "The API took too long to respond." : "Can't reach the API.");
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);
    throw new ApiError(response.status, parsed.success ? parsed.data.error : `HTTP ${response.status}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(response.status, "Unexpected response from the API.");
  }
  return parsed.data;
}

// Copy for people, chosen by status. The 400 message from the API is already written for
// people ("invalid url: must be http or https with a host, ..."); others are not.
export function userMessage(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }
  switch (err.status) {
    case 0:
      return `${err.message} Check your connection and try again.`;
    case 400:
      return err.message;
    case 404:
      return "There is no link with that code, or it has expired.";
    case 429:
      return "Too many requests right now. Wait a few seconds and try again.";
    default:
      return "Something went wrong on our side. Please try again.";
  }
}

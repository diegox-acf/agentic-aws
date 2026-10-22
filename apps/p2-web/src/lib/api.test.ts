import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, createLink, getStats, userMessage } from "./api";

const API = "https://abc123.execute-api.us-east-1.amazonaws.com";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("createLink", () => {
  it("POSTs the url as JSON and returns the short link", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { code: "aB3xY9z", shortUrl: `${API}/aB3xY9z` }),
    );

    const link = await createLink("https://aws.amazon.com/lambda/");

    expect(link).toEqual({ code: "aB3xY9z", shortUrl: `${API}/aB3xY9z` });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/links`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ url: "https://aws.amazon.com/lambda/" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns a 400 into an ApiError carrying the server's message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: "invalid url: must be http or https" }));

    const err = await createLink("ftp://x").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: "invalid url: must be http or https" });
  });

  it("rejects a 2xx response whose body has the wrong shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { code: 42 }));

    await expect(createLink("https://example.com")).rejects.toMatchObject({
      status: 201,
      message: expect.stringMatching(/unexpected response/i),
    });
  });
});

describe("getStats", () => {
  it("GETs /links/{code} and returns the stats", async () => {
    const stats = { url: "https://aws.amazon.com/", clicks: 7, createdAt: "2026-10-19T09:00:00Z" };
    fetchMock.mockResolvedValue(jsonResponse(200, stats));

    await expect(getStats("aB3xY9z")).resolves.toEqual(stats);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/links/aB3xY9z`);
  });

  it("never sends a malformed code to the API", async () => {
    await expect(getStats("../admin")).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a 404 to an ApiError with status 404", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: "not found" }));

    await expect(getStats("zzzzzzz")).rejects.toMatchObject({ status: 404 });
  });
});

describe("failures without a usable response", () => {
  it("reports a network failure (fetch rejects) as status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getStats("aB3xY9z")).rejects.toMatchObject({ status: 0 });
  });

  it("reports a timeout as status 0", async () => {
    fetchMock.mockRejectedValue(new DOMException("signal timed out", "TimeoutError"));

    await expect(getStats("aB3xY9z")).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/too long/i),
    });
  });

  it("uses a generic message when an error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 }));

    await expect(getStats("aB3xY9z")).rejects.toMatchObject({ status: 502, message: "HTTP 502" });
  });
});

// Fields from the API end up in hrefs; P1 validates them today, but the client doesn't rely on it.
describe("untrusted fields in a 2xx body", () => {
  const createdAt = "2026-10-19T09:00:00Z";

  it.each([
    ["a javascript: destination", { url: "javascript:alert(1)", clicks: 0, createdAt }],
    ["a data: destination", { url: "data:text/html,<script>alert(1)</script>", clicks: 0, createdAt }],
    ["a createdAt that is not a timestamp", { url: "https://aws.amazon.com/", clicks: 0, createdAt: "yesterday" }],
  ])("rejects stats with %s", async (_label, body) => {
    fetchMock.mockResolvedValue(jsonResponse(200, body));

    await expect(getStats("aB3xY9z")).rejects.toMatchObject({
      status: 200,
      message: expect.stringMatching(/unexpected response/i),
    });
  });

  it.each([
    ["a javascript: shortUrl", { code: "aB3xY9z", shortUrl: "javascript:alert(1)" }],
    ["a code that is not 7 base62 characters", { code: "../x?y=1", shortUrl: `${API}/aB3xY9z` }],
  ])("rejects a short link with %s", async (_label, body) => {
    fetchMock.mockResolvedValue(jsonResponse(201, body));

    await expect(createLink("https://example.com")).rejects.toMatchObject({
      status: 201,
      message: expect.stringMatching(/unexpected response/i),
    });
  });
});

describe("configuration errors", () => {
  it("reports a missing NEXT_PUBLIC_API_URL as such, not as a network failure", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");

    await expect(createLink("https://example.com")).rejects.toThrow(/NEXT_PUBLIC_API_URL is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("userMessage", () => {
  it.each([
    [new ApiError(400, "invalid url: must be http or https"), /invalid url/],
    [new ApiError(404, "not found"), /no link with that code/i],
    [new ApiError(429, "Too Many Requests"), /too many requests/i],
    [new ApiError(0, "Can't reach the API"), /can't reach the api/i],
    [new ApiError(500, "internal error"), /something went wrong/i],
    [new Error("boom"), /something went wrong/i],
    ["not an error", /something went wrong/i],
  ])("maps %o to copy a person can act on", (err, expected) => {
    expect(userMessage(err)).toMatch(expected);
  });
});

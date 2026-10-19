import { describe, expect, it, vi } from "vitest";

import { apiBaseUrl } from "./config";

describe("apiBaseUrl", () => {
  it("returns the configured API URL without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://abc123.execute-api.us-east-1.amazonaws.com/");

    expect(apiBaseUrl()).toBe("https://abc123.execute-api.us-east-1.amazonaws.com");
  });

  it("allows plain http only for localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8080");

    expect(apiBaseUrl()).toBe("http://localhost:8080");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["not a URL", "execute-api"],
    ["plain http to a real host", "http://abc123.execute-api.us-east-1.amazonaws.com"],
  ])("throws when the URL is %s", (_, value) => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", value);

    expect(() => apiBaseUrl()).toThrow(/NEXT_PUBLIC_API_URL/);
  });
});

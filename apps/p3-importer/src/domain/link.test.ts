import { describe, expect, it } from "vitest";
import { LINK_TTL_SECONDS, toLinkItem } from "./link";

describe("toLinkItem", () => {
  it("builds P1's item shape plus the importId that wrote it", () => {
    const now = new Date("2026-10-26T12:00:00.000Z");

    expect(toLinkItem({ code: "abc1234", url: "https://example.com", importId: "imp-1", now })).toStrictEqual({
      code: "abc1234",
      url: "https://example.com",
      clicks: 0,
      createdAt: "2026-10-26T12:00:00.000Z", // RFC 3339, like Go's time.Time
      expiresAt: now.getTime() / 1000 + LINK_TTL_SECONDS, // unix seconds, P1's TTL attribute
      importId: "imp-1",
    });
  });

  it("expires 30 days after creation, like P1's links", () => {
    expect(LINK_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("drops sub-second precision from expiresAt", () => {
    const item = toLinkItem({ code: "abc1234", url: "https://x.io", importId: "i", now: new Date("2026-10-26T12:00:00.999Z") });
    expect(Number.isInteger(item.expiresAt)).toBe(true);
  });
});

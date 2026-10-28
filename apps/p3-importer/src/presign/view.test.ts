import { describe, expect, it } from "vitest";
import type { ImportRecord } from "../domain/imports";
import { toView } from "./view";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;

const pending: ImportRecord = {
  importId: "3f1c2a9e-8b4d-4c6e-9a7f-1b2c3d4e5f60",
  status: "PENDING",
  createdAt: "2026-10-26T11:59:00.000Z",
  expiresAt: NOW_SECONDS + 60,
};

describe("toView", () => {
  it("returns the public fields of a pending import, without expiresAt", () => {
    expect(toView(pending, NOW)).toStrictEqual({
      importId: pending.importId,
      status: "PENDING",
      createdAt: pending.createdAt,
    });
  });

  it("includes the sample of rejected rows, so a caller can see why rows were rejected", () => {
    const rejectedSample = [{ row: 2, reason: "invalid URL" }];
    const done: ImportRecord = { ...pending, status: "DONE", created: 1, rejected: 1, rejectedSample };

    expect(toView(done, NOW)).toMatchObject({ rejectedSample });
  });

  it("includes the counts and finish time of a finished import", () => {
    const done: ImportRecord = {
      ...pending,
      status: "DONE",
      created: 41,
      rejected: 2,
      finishedAt: "2026-10-26T12:00:00.000Z",
    };

    expect(toView(done, NOW)).toStrictEqual({
      importId: pending.importId,
      status: "DONE",
      createdAt: pending.createdAt,
      created: 41,
      rejected: 2,
      finishedAt: "2026-10-26T12:00:00.000Z",
    });
  });

  it("includes the reason of a failed import", () => {
    const failed: ImportRecord = { ...pending, status: "FAILED", error: "file larger than 1048576 bytes" };

    expect(toView(failed, NOW)).toMatchObject({ status: "FAILED", error: "file larger than 1048576 bytes" });
  });

  it("returns null once expiresAt has passed", () => {
    expect(toView({ ...pending, expiresAt: NOW_SECONDS - 1 }, NOW)).toBeNull();
  });

  it("returns null when expiresAt is exactly now (P1 treats expiresAt <= now as gone)", () => {
    expect(toView({ ...pending, expiresAt: NOW_SECONDS }, NOW)).toBeNull();
  });

  it("does not modify the record it is given", () => {
    const record = { ...pending };
    toView(record, NOW);
    expect(record).toStrictEqual(pending);
  });
});

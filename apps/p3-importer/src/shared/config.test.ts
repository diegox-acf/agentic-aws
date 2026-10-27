import { describe, expect, it } from "vitest";
import { loadPresignConfig } from "./config";

describe("loadPresignConfig", () => {
  it("reads the required names and applies defaults", () => {
    const config = loadPresignConfig({ IMPORTS_TABLE: "imports", BUCKET_NAME: "bucket" });

    expect(config).toEqual({
      importsTable: "imports",
      bucketName: "bucket",
      urlTtlSeconds: 300,
      maxUploadBytes: 1_048_576,
    });
  });

  it("parses numeric overrides from strings", () => {
    const config = loadPresignConfig({
      IMPORTS_TABLE: "imports",
      BUCKET_NAME: "bucket",
      URL_TTL_SECONDS: "60",
      MAX_UPLOAD_BYTES: "2048",
    });

    expect(config.urlTtlSeconds).toBe(60);
    expect(config.maxUploadBytes).toBe(2048);
  });

  it("fails fast naming every missing variable", () => {
    expect(() => loadPresignConfig({})).toThrow(/IMPORTS_TABLE.*BUCKET_NAME|BUCKET_NAME.*IMPORTS_TABLE/s);
  });

  it("rejects an empty table name", () => {
    expect(() => loadPresignConfig({ IMPORTS_TABLE: "", BUCKET_NAME: "bucket" })).toThrow(/IMPORTS_TABLE/);
  });

  it.each(["abc", "0", "-5", "1.5", "3601"])("rejects URL_TTL_SECONDS=%s", (value) => {
    expect(() =>
      loadPresignConfig({ IMPORTS_TABLE: "imports", BUCKET_NAME: "bucket", URL_TTL_SECONDS: value }),
    ).toThrow(/URL_TTL_SECONDS/);
  });

  it("rejects MAX_UPLOAD_BYTES below 1", () => {
    expect(() =>
      loadPresignConfig({ IMPORTS_TABLE: "imports", BUCKET_NAME: "bucket", MAX_UPLOAD_BYTES: "0" }),
    ).toThrow(/MAX_UPLOAD_BYTES/);
  });
});

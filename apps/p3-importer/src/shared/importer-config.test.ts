import { describe, expect, it } from "vitest";
import { loadImporterConfig } from "./importer-config";

const REQUIRED = {
  LINKS_TABLE: "links",
  IMPORTS_TABLE: "imports",
  BUCKET_NAME: "imports-bucket",
  RESULTS_TOPIC_ARN: "arn:aws:sns:us-east-1:111111111111:results",
};

describe("loadImporterConfig", () => {
  it("reads the required names and applies defaults", () => {
    expect(loadImporterConfig(REQUIRED)).toStrictEqual({
      linksTable: "links",
      importsTable: "imports",
      bucketName: "imports-bucket",
      resultsTopicArn: REQUIRED.RESULTS_TOPIC_ARN,
      maxUploadBytes: 1_048_576,
      maxRows: 1000,
      writeConcurrency: 10,
    });
  });

  it("parses numeric overrides", () => {
    const config = loadImporterConfig({ ...REQUIRED, MAX_UPLOAD_BYTES: "2048", MAX_ROWS: "50", WRITE_CONCURRENCY: "4" });
    expect([config.maxUploadBytes, config.maxRows, config.writeConcurrency]).toStrictEqual([2048, 50, 4]);
  });

  it("fails fast naming every missing variable", () => {
    expect(() => loadImporterConfig({})).toThrow(/LINKS_TABLE.*IMPORTS_TABLE.*BUCKET_NAME.*RESULTS_TOPIC_ARN/s);
  });

  it.each(["0", "abc"])("rejects MAX_ROWS=%s", (value) => {
    expect(() => loadImporterConfig({ ...REQUIRED, MAX_ROWS: value })).toThrow(/MAX_ROWS/);
  });

  it.each(["0", "26", "abc"])("rejects WRITE_CONCURRENCY=%s", (value) => {
    expect(() => loadImporterConfig({ ...REQUIRED, WRITE_CONCURRENCY: value })).toThrow(/WRITE_CONCURRENCY/);
  });

  it("rejects a topic that isn't an SNS ARN", () => {
    expect(() => loadImporterConfig({ ...REQUIRED, RESULTS_TOPIC_ARN: "results" })).toThrow(/RESULTS_TOPIC_ARN/);
  });
});

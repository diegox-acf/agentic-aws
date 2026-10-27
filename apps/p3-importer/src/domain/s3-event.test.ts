import { describe, expect, it } from "vitest";
import { parseImportEvent } from "./s3-event";

const IMPORT_ID = "3f1c2a9e-8b4d-4c6e-9a7f-1b2c3d4e5f60";

// What EventBridge delivers to SQS for an S3 upload: the whole event is the message body.
function objectCreated(overrides: { key?: string; size?: unknown; source?: string; detailType?: string } = {}): string {
  return JSON.stringify({
    version: "0",
    id: "17793124-05d4-b198-2fde-7ededc63b103",
    "detail-type": overrides.detailType ?? "Object Created",
    source: overrides.source ?? "aws.s3",
    account: "111111111111",
    time: "2026-10-26T12:00:00Z",
    region: "us-east-1",
    resources: ["arn:aws:s3:::agentic-aws-dev-imports-111111111111"],
    detail: {
      version: "0",
      bucket: { name: "agentic-aws-dev-imports-111111111111" },
      object: { key: overrides.key ?? `incoming/${IMPORT_ID}.csv`, size: overrides.size ?? 1234, etag: "abc", sequencer: "0055AED6DCD90281E5" },
      "request-id": "D82B88E5F771F645",
      requester: "111111111111",
      reason: "PostObject",
    },
  });
}

describe("parseImportEvent", () => {
  it("extracts bucket, key, size and the importId from the key", () => {
    expect(parseImportEvent(objectCreated())).toStrictEqual({
      bucket: "agentic-aws-dev-imports-111111111111",
      key: `incoming/${IMPORT_ID}.csv`,
      size: 1234,
      importId: IMPORT_ID,
    });
  });

  it.each([
    ["not JSON", "{oops"],
    ["another source", objectCreated({ source: "aws.ec2" })],
    ["another event type", objectCreated({ detailType: "Object Deleted" })],
    ["a key outside incoming/", objectCreated({ key: `other/${IMPORT_ID}.csv` })],
    ["a key that isn't <uuid>.csv", objectCreated({ key: "incoming/report.csv" })],
    ["a nested key", objectCreated({ key: `incoming/x/${IMPORT_ID}.csv` })],
    ["a negative size", objectCreated({ size: -1 })],
    ["a size that isn't a number", objectCreated({ size: "12" })],
  ])("throws for %s", (_name, body) => {
    expect(() => parseImportEvent(body)).toThrow(/unrecognized import event/);
  });
});

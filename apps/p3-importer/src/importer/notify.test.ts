import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { snsNotifier } from "./notify";

const snsMock = mockClient(SNSClient);
const notify = snsNotifier(new SNSClient({ region: "us-east-1" }), "arn:aws:sns:us-east-1:111111111111:results");
const IMPORT_ID = "3f1c2a9e-8b4d-4c6e-9a7f-1b2c3d4e5f60";

beforeEach(() => snsMock.reset());

describe("snsNotifier", () => {
  it("publishes a readable subject and the summary as JSON", async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: "m-1" });

    await notify({ importId: IMPORT_ID, status: "DONE", created: 41, rejected: 2 });

    const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input;
    expect(input?.TopicArn).toBe("arn:aws:sns:us-east-1:111111111111:results");
    expect(input?.Subject).toBe("Import DONE: 41 created, 2 rejected");
    expect(JSON.parse(input?.Message ?? "")).toStrictEqual({ importId: IMPORT_ID, status: "DONE", created: 41, rejected: 2 });
  });

  it("keeps the subject within SNS's 100-character limit", async () => {
    snsMock.on(PublishCommand).resolves({});

    await notify({ importId: IMPORT_ID, status: "FAILED", created: 0, rejected: 0, error: "x".repeat(500) });

    expect(snsMock.commandCalls(PublishCommand)[0]?.args[0].input.Subject?.length).toBeLessThanOrEqual(100);
  });

  it("rethrows a failed publish so the message is retried", async () => {
    snsMock.on(PublishCommand).rejects(new Error("AuthorizationError"));

    await expect(notify({ importId: IMPORT_ID, status: "DONE", created: 1, rejected: 0 })).rejects.toThrow("AuthorizationError");
  });
});

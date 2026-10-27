import { z } from "zod";
import { IMPORT_ID_PATTERN } from "./imports";

// Presign only ever signs uploads for incoming/<importId>.csv.
const IMPORT_KEY = new RegExp(`^incoming/(${IMPORT_ID_PATTERN})\\.csv$`);

// The parts we use of the event EventBridge puts in the SQS message body for an S3 upload
// ("Object Created", from S3's EventBridge notifications). Unknown fields are ignored.
const objectCreated = z.object({
  source: z.literal("aws.s3"),
  "detail-type": z.literal("Object Created"),
  detail: z.object({
    bucket: z.object({ name: z.string().min(1) }),
    object: z.object({
      key: z.string().regex(IMPORT_KEY),
      size: z.number().int().nonnegative(), // bytes, known before downloading anything
    }),
  }),
});

export interface ImportObject {
  bucket: string;
  key: string;
  size: number;
  importId: string;
}

/** Parses an SQS message body into the uploaded object, or throws if it isn't one of ours. */
export function parseImportEvent(body: string): ImportObject {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error("unrecognized import event: body is not JSON");
  }
  const parsed = objectCreated.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`unrecognized import event: ${problems}`);
  }
  const { bucket, object } = parsed.data.detail;
  const importId = IMPORT_KEY.exec(object.key)?.[1];
  if (importId === undefined) {
    throw new Error("unrecognized import event: key has no importId"); // unreachable: the schema checked the key
  }
  return { bucket: bucket.name, key: object.key, size: object.size, importId };
}

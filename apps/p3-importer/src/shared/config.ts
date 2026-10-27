import { z } from "zod";

// Environment variables arrive as strings; coerce and validate them once at cold start, so a
// misconfigured function fails its first invocation (an init error) instead of misbehaving.
const presignEnv = z.object({
  IMPORTS_TABLE: z.string().min(1),
  BUCKET_NAME: z.string().min(1),
  // A presigned POST stays usable until it expires; keep it short. AWS caps it at 7 days, we at 1 h.
  URL_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).default(1_048_576),
});

export interface PresignConfig {
  importsTable: string;
  bucketName: string;
  urlTtlSeconds: number;
  maxUploadBytes: number;
}

export function loadPresignConfig(env: Record<string, string | undefined>): PresignConfig {
  const parsed = presignEnv.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid presign configuration: ${problems}`);
  }
  const { IMPORTS_TABLE, BUCKET_NAME, URL_TTL_SECONDS, MAX_UPLOAD_BYTES } = parsed.data;
  return {
    importsTable: IMPORTS_TABLE,
    bucketName: BUCKET_NAME,
    urlTtlSeconds: URL_TTL_SECONDS,
    maxUploadBytes: MAX_UPLOAD_BYTES,
  };
}

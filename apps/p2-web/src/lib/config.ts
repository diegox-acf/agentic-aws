// NEXT_PUBLIC_* variables are inlined into the bundle by `next build`, so each build talks to
// one API. Keep the literal `process.env.NEXT_PUBLIC_API_URL`: dynamic lookups are not inlined.
export function apiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) {
    throw new Error("NEXT_PUBLIC_API_URL is not set; set it when running `next build`");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NEXT_PUBLIC_API_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("NEXT_PUBLIC_API_URL must use https (plain http only for localhost)");
  }
  return raw.replace(/\/+$/, "");
}

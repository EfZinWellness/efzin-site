import { allowRequest, clientIp } from "./throttle";

export const MAX_BODY_BYTES = 32 * 1024;

/** Reads the body with a size cap. Returns a 413 Response, or the raw body text. */
export async function readCappedBody(req: Request): Promise<Response | { text: string }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Request too large" }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Request too large" }, { status: 413 });
  return { text };
}

/**
 * Throttles by IP (default: 5 per 10 minutes, or the given limiter) and reads the body with a
 * size cap. Returns a Response to send, or the raw body text.
 */
export async function guardPost(
  req: Request,
  bucket: string,
  allow: (key: string) => boolean = allowRequest,
): Promise<Response | { text: string }> {
  if (!allow(`${bucket}:${clientIp(req)}`)) {
    return Response.json({ ok: false, error: "Too many requests. Please try again later." }, { status: 429 });
  }
  return readCappedBody(req);
}

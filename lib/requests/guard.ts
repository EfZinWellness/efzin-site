import { allowRequest, clientIp } from "./throttle";

export const MAX_BODY_BYTES = 32 * 1024;

/** Throttles by IP and reads the body with a size cap. Returns a Response to send, or the raw body text. */
export async function guardPost(req: Request, bucket: string): Promise<Response | { text: string }> {
  if (!allowRequest(`${bucket}:${clientIp(req)}`)) {
    return Response.json({ ok: false, error: "Too many requests. Please try again later." }, { status: 429 });
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Request too large" }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Request too large" }, { status: 413 });
  return { text };
}
import { handleWaitlist } from "@/lib/booking/waitlist";
import { getSqlClient } from "@/lib/db/client";
import { guardPost } from "@/lib/requests/guard";

/** The waitlist form (JSON or a plain HTML post, which is sent back to the page with the outcome). */
export async function POST(req: Request) {
  const guarded = await guardPost(req, "waitlist");
  if (guarded instanceof Response) return guarded;
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  let body: Record<string, unknown>;
  try {
    body = isJson ? JSON.parse(guarded.text) : Object.fromEntries(new URLSearchParams(guarded.text));
  } catch {
    return Response.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const res = await handleWaitlist(body, { db: await getSqlClient(), now: new Date() });
  const slug = typeof body.slug === "string" && /^[a-z0-9-]{1,120}$/.test(body.slug) ? body.slug : null;
  if (!isJson && slug) {
    const outcome = res.status === 200 ? (res.result === "ignored" ? "joined" : res.result) : "error";
    return new Response(null, { status: 303, headers: { Location: `/waitlist/${slug}?result=${outcome}` } });
  }
  return Response.json({ ok: res.status === 200, result: res.result, error: res.error }, { status: res.status });
}

import { getSqlClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { guardPost } from "@/lib/requests/guard";
import { handleRequest } from "@/lib/requests/handlers";

export async function POST(req: Request) {
  const guarded = await guardPost(req, "requests");
  if (guarded instanceof Response) return guarded;
  let body: unknown;
  try {
    body = JSON.parse(guarded.text);
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const res = await handleRequest(body, { db: await getSqlClient(), sendEmail });
  return Response.json(res.body, { status: res.status });
}
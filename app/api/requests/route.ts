import { getSqlClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { handleRequest } from "@/lib/requests/handlers";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const res = await handleRequest(body, { db: await getSqlClient(), sendEmail });
  return Response.json(res.body, { status: res.status });
}
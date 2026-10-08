import { getSqlClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { handleBalanceLookup } from "@/lib/giftcards/balance";
import { readCappedBody } from "@/lib/requests/guard";
import { clientIp } from "@/lib/requests/throttle";

export async function POST(req: Request) {
  const read = await readCappedBody(req);
  if (read instanceof Response) return read;
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return Response.json({ found: false, error: "Invalid JSON" }, { status: 400 });
  }
  const db = await getSqlClient();
  if (!db) return Response.json({ found: false, error: "Balances cannot be checked right now" }, { status: 503 });
  const res = await handleBalanceLookup(body, clientIp(req), { db, now: new Date(), sendEmail });
  return Response.json(res.body, { status: res.status });
}

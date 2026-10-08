import { handleCodeCheck } from "@/lib/booking/codes";
import { loadExperience } from "@/lib/content/load";
import { getSqlClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { getUsdRates } from "@/lib/pricing/rates";
import { readCappedBody } from "@/lib/requests/guard";
import { clientIp } from "@/lib/requests/throttle";

export async function POST(req: Request) {
  const read = await readCappedBody(req);
  if (read instanceof Response) return read;
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return Response.json({ valid: false, error: "Invalid JSON" }, { status: 400 });
  }
  const db = await getSqlClient();
  if (!db) return Response.json({ valid: false, error: "Codes cannot be checked right now" }, { status: 503 });
  const slug = typeof body === "object" && body !== null ? (body as { slug?: unknown }).slug : undefined;
  const experience = typeof slug === "string" ? await loadExperience(slug) : null;
  const res = await handleCodeCheck(body, clientIp(req), {
    db,
    usdRates: await getUsdRates(),
    now: new Date(),
    sendEmail,
    experience,
  });
  return Response.json(res.body, { status: res.status });
}

import { getSqlClient } from "@/lib/db/client";
import { handleNewsletter } from "@/lib/requests/handlers";

export async function POST(req: Request) {
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  let body: unknown;
  try {
    body = isJson ? await req.json() : Object.fromEntries(await req.formData());
  } catch {
    return Response.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const res = await handleNewsletter(body, { db: await getSqlClient() });
  // Plain HTML form posts (no JavaScript) get sent back to the page.
  if (!isJson && res.status === 200) {
    return new Response(null, { status: 303, headers: { Location: "/?subscribed=1" } });
  }
  return Response.json(res.body, { status: res.status });
}
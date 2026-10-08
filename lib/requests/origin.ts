import { headers } from "next/headers";

/** Site origin for links and return URLs: NEXT_PUBLIC_SITE_ORIGIN, else the request's own host. */
export async function requestOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

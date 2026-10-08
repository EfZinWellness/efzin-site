import { headers } from "next/headers";
import { SITE_URL } from "../site";

/**
 * Site origin for links and return URLs: NEXT_PUBLIC_SITE_ORIGIN (required in production).
 * Production never trusts the Host header; without the variable it falls back to the public
 * site URL. Development uses the request's own host.
 */
export async function requestOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    console.error("[config] NEXT_PUBLIC_SITE_ORIGIN is not set; using", SITE_URL);
    return SITE_URL;
  }
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  return `http://${host}`;
}

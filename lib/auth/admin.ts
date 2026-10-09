import { notFound } from "next/navigation";
import { getCurrentPerson, type CurrentPerson } from "./session";

/** True when the email is on the ADMIN_EMAILS allowlist (comma-separated, case-insensitive, trimmed). */
export function isAdmin(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(e);
}

/** The signed-in admin, or null for everybody else (including signed-out visitors). */
export async function adminPerson(): Promise<CurrentPerson | null> {
  const me = await getCurrentPerson();
  return me && isAdmin(me.email) ? me : null;
}

/** For admin pages: the signed-in admin, else a 404 (never a redirect that would reveal the route). */
export async function requireAdmin(): Promise<CurrentPerson> {
  const me = await adminPerson();
  if (!me) notFound();
  return me;
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { TEST_AUTH_COOKIE, testAuthEmail } from "./lib/auth/testSeam";

// /account/cancellation/<token>: the refund-or-credit choice after Ef Zin cancels (token only, no login).
const PUBLIC = ["/account/signin", "/account/auth", "/account/cancellation"];

/**
 * /account/* needs a session: refreshes the Supabase auth cookies and sends visitors without
 * a session to /account/signin. (Pages check again with getCurrentPerson.)
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();

  if (process.env.NODE_ENV !== "production" && testAuthEmail(process.env, request.cookies.has(TEST_AUTH_COOKIE))) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  let signedIn = false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  }
  if (signedIn) return response;

  const to = request.nextUrl.clone();
  to.pathname = "/account/signin";
  to.search = "";
  const redirect = NextResponse.redirect(to);
  // Keep any refreshed/cleared auth cookies.
  for (const c of response.cookies.getAll()) redirect.cookies.set(c);
  return redirect;
}

export const config = {
  matcher: ["/account", "/account/:path*"],
};

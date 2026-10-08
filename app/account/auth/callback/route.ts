import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/db/supabase-server";

/** Landing for the email link and Google: swaps the one-time code for a session cookie. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const to = request.nextUrl.clone();
  to.search = "";
  const supabase = await getSupabaseServer();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      to.pathname = "/account";
      return NextResponse.redirect(to);
    }
    console.error("[auth] code exchange failed", error.message);
  }
  to.pathname = "/account/signin";
  to.searchParams.set("error", "link");
  return NextResponse.redirect(to);
}

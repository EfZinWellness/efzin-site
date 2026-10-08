import { confirmSignIn } from "../../auth-actions";

export const metadata = { title: "Sign in | Ef Zin", robots: { index: false }, referrer: "no-referrer" as const };

/** Landing page of an emailed sign-in link: one tap to sign in (the token is verified on the server). */
export default async function ConfirmSignInPage({ searchParams }: PageProps<"/account/auth/confirm">) {
  const q = await searchParams;
  const tokenHash = typeof q.token_hash === "string" ? q.token_hash : "";
  const type = typeof q.type === "string" ? q.type : "";

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-14 text-center">
      <p className="greek text-sm">εὖ ζῆν</p>
      <h1 className="mt-2 font-serif text-3xl">Welcome to My Ef Zin</h1>
      <p className="mt-4 text-sm leading-6 text-navy/80">Tap below to sign in on this device.</p>
      <form action={confirmSignIn} className="mt-8">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <button type="submit" className="btn btn-solid w-full">Sign in</button>
      </form>
    </div>
  );
}

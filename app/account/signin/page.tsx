import Link from "next/link";
import { redirect } from "next/navigation";
import SignInForm from "@/components/account/SignInForm";
import { getSessionState } from "@/lib/auth/session";
import { WHATSAPP_URL } from "@/lib/site";
import { signOut } from "../auth-actions";

export const metadata = { title: "Sign in | Ef Zin", robots: { index: false } };

export default async function SignInPage({ searchParams }: PageProps<"/account/signin">) {
  const session = await getSessionState();
  if (session.kind === "person") redirect("/account");
  const linkError = (await searchParams).error === "link";

  if (session.kind === "no_profile") {
    return (
      <div className="mx-auto max-w-md px-4 pb-20 pt-14 text-center">
        <h1 className="font-serif text-3xl">We couldn&rsquo;t find your Ef Zin profile</h1>
        <p className="mt-4 text-sm leading-6 text-navy/80">
          You&rsquo;re signed in{session.email ? ` as ${session.email}` : ""}, but we couldn&rsquo;t match this to an Ef Zin
          profile. Please contact us and we&rsquo;ll sort it out.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <a href={WHATSAPP_URL} className="btn btn-solid">Message us on WhatsApp</a>
          <Link href="/contact" className="btn">Contact</Link>
        </div>
        <form action={signOut} className="mt-6">
          <button type="submit" className="text-[10px] uppercase tracking-[0.2em] underline underline-offset-4">Sign out</button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-14">
      <p className="greek text-center text-sm">εὖ ζῆν</p>
      <h1 className="mt-2 text-center font-serif text-3xl">Sign in to My Ef Zin</h1>
      <p className="mt-4 text-center text-sm leading-6 text-navy/80">
        Your bookings, payment plans, gift cards and health details in one place. No password needed: we email you a
        link.
      </p>
      {linkError ? (
        <p className="mt-6 border border-oxblood/40 p-3 text-center text-sm text-oxblood">
          That link has expired or was already used. Enter your email for a new one.
        </p>
      ) : null}
      <div className="mt-8">
        <SignInForm />
      </div>
      <p className="mt-10 text-center text-xs leading-5 text-navy/60">
        Booked with us before? Use the email you booked with and your bookings will be waiting.
      </p>
    </div>
  );
}

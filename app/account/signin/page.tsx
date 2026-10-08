import { redirect } from "next/navigation";
import HashSession from "@/components/account/HashSession";
import SignInForm from "@/components/account/SignInForm";
import { getCurrentPerson } from "@/lib/auth/session";

export const metadata = { title: "Sign in | Ef Zin", robots: { index: false } };

export default async function SignInPage({ searchParams }: PageProps<"/account/signin">) {
  if (await getCurrentPerson()) redirect("/account");
  const linkError = (await searchParams).error === "link";

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-14">
      <HashSession />
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

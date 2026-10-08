import Link from "next/link";
import BalanceForm from "@/components/BalanceForm";

export const metadata = { title: "Check your gift card balance | Ef Zin", robots: { index: false } };

export default function GiftBalancePage() {
  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-14">
      <p className="greek text-center text-sm">εὖ ζῆν</p>
      <h1 className="mt-2 text-center font-serif text-3xl">Check your balance</h1>
      <p className="mt-4 text-center text-sm text-navy/80">Enter your gift card code to see what is left and when it expires.</p>
      <div className="mt-8">
        <BalanceForm />
      </div>
      <p className="mt-10 text-center">
        <Link href="/gift" className="eyebrow underline underline-offset-4">Give a gift card</Link>
      </p>
    </div>
  );
}

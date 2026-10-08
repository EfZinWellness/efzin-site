import { requestDeletionAction } from "@/app/account/actions";
import AccountNav from "@/components/account/AccountNav";
import ActionButton from "@/components/account/ActionButton";
import HealthForm from "@/components/account/HealthForm";
import Mdx from "@/components/Mdx";
import { loadHealth } from "@/lib/account/health";
import { requirePerson } from "@/lib/auth/session";
import { loadPage } from "@/lib/content/load";
import { getSqlClient } from "@/lib/db/client";

export const metadata = { title: "Health details | My Ef Zin", robots: { index: false } };

export default async function HealthPage() {
  const me = await requirePerson();
  const db = await getSqlClient();
  // Health data is only ever read for the signed-in person.
  const health = db ? await loadHealth(db, me.personId) : { profile: null, waiverAcceptedAt: null };
  const waiver = await loadPage("waiver");

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-10">
      <h1 className="text-center font-serif text-3xl">Health details &amp; waiver</h1>
      <p className="mt-3 text-center text-sm leading-6 text-navy/80">
        So we can keep you safe and cook for you. It takes about a minute.
      </p>
      <AccountNav current="/account/health" />

      <details className="mt-8 border border-sand bg-white/60 px-4 py-3" open={!health.waiverAcceptedAt}>
        <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em]">
          {typeof waiver.data.title === "string" ? waiver.data.title : "Waiver"}
        </summary>
        <div className="max-h-80 overflow-y-auto pb-2">
          <Mdx source={waiver.body} />
        </div>
      </details>

      <HealthForm profile={health.profile} waiverAcceptedAt={health.waiverAcceptedAt} />

      <section className="mt-14 border-t border-sand/60 pt-8">
        <h2 className="font-serif text-xl">Your data</h2>
        <p className="mt-2 text-sm leading-6 text-navy/80">
          You can ask us to delete your account and personal data, including these health details. We&rsquo;ll confirm by
          email within 30 days. Records we must keep by law (such as payments) are kept only as long as required.
        </p>
        <ActionButton action={requestDeletionAction} label="Request deletion of my data" pendingLabel="Sending" className="mt-4" />
      </section>
    </div>
  );
}

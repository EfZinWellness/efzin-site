import Link from "next/link";
import { resendGiftAction } from "@/app/account/actions";
import AccountNav from "@/components/account/AccountNav";
import ActionButton from "@/components/account/ActionButton";
import { formatExpiry } from "@/lib/account/format";
import { loadGiftCards, type AccountGiftCard } from "@/lib/account/giftCards";
import { requirePerson } from "@/lib/auth/session";
import { getSqlClient } from "@/lib/db/client";
import { formatAed } from "@/lib/giftcards/money";

export const metadata = { title: "Gift cards | My Ef Zin", robots: { index: false } };

function Card({ card, line }: { card: AccountGiftCard; line: string }) {
  const active = card.status === "active";
  return (
    <li className="border border-sand bg-white/60 px-4 py-4">
      <p className="break-all font-mono text-sm tracking-wider">{card.code}</p>
      <p className="mt-2 text-sm">
        Balance <strong className="font-medium">{formatAed(card.balanceAedMinor)}</strong>
        <span className="text-navy/60"> of {formatAed(card.initialAedMinor)}</span>
      </p>
      <p className="mt-1 text-xs text-navy/70">
        {line}
        {card.expiresAt ? ` · ${active ? "valid until" : "expired"} ${formatExpiry(card.expiresAt)}` : ""}
      </p>
      {card.canResend ? (
        <ActionButton action={resendGiftAction} fields={{ giftCardId: card.id }} label="Email me the code" pendingLabel="Sending" className="mt-4" />
      ) : null}
    </li>
  );
}

export default async function GiftCardsPage() {
  const me = await requirePerson();
  const db = await getSqlClient();
  const { bought, received } = db ? await loadGiftCards(db, me.personId, new Date()) : { bought: [], received: [] };

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-10">
      <h1 className="text-center font-serif text-3xl">Gift cards</h1>
      <AccountNav current="/account/gift-cards" />

      <h2 className="mt-10 font-serif text-xl">Received</h2>
      {received.length === 0 ? (
        <p className="mt-3 text-sm text-navy/80">No gift cards received yet. A card sent to your email shows here.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {received.map((c) => <Card key={c.id} card={c} line={`From ${c.fromName}`} />)}
        </ul>
      )}

      <h2 className="mt-10 font-serif text-xl">Bought</h2>
      {bought.length === 0 ? (
        <p className="mt-3 text-sm text-navy/80">You haven&rsquo;t bought a gift card yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {bought.map((c) => <Card key={c.id} card={c} line={`For ${c.recipientLabel}`} />)}
        </ul>
      )}

      <p className="mt-8 text-xs leading-5 text-navy/60">Codes are only ever emailed to you, at {me.email}.</p>
      <p className="mt-8 text-center">
        <Link href="/gift" className="btn">Give a gift card</Link>
      </p>
    </div>
  );
}

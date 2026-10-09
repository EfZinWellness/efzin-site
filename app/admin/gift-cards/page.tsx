import { ExportLink, NoDatabase, PageTitle, Stat } from "@/components/admin/ui";
import { adminDb } from "@/lib/admin/access";
import { loadAdminGiftCards } from "@/lib/admin/giftCards";
import { formatExpiry } from "@/lib/account/format";
import { formatAed } from "@/lib/giftcards/money";

export default async function AdminGiftCardsPage() {
  const db = await adminDb();
  if (!db) return <><PageTitle>Gift cards</PageTitle><NoDatabase /></>;
  const { cards, totals } = await loadAdminGiftCards(db);

  return (
    <>
      <PageTitle sub="Gift card sales are kept out of experience revenue.">Gift cards</PageTitle>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Sales" value={formatAed(totals.salesAedMinor)} note="Every card issued." />
        <Stat label="Outstanding" value={formatAed(totals.outstandingAedMinor)} note="Balance on active cards, owed in future experiences." />
        <Stat label="Expired" value={formatAed(totals.expiredAedMinor)} note="Value that lapsed." />
      </div>

      {cards.length === 0 ? (
        <p className="mt-8 text-sm text-navy/80">No gift cards yet.</p>
      ) : (
        <table className="stack mt-8">
          <thead>
            <tr><th>Code</th><th>Buyer</th><th>Recipient</th><th>Value</th><th>Balance</th><th>Expires</th><th>Status</th></tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id}>
                <td className="lead font-mono text-xs tracking-wider">{c.code}</td>
                <td data-label="Buyer">{c.buyerName}<span className="block text-xs text-stone">{c.buyerEmail}</span></td>
                <td data-label="Recipient">{c.recipientName ?? "-"}{c.recipientEmail ? <span className="block text-xs text-stone">{c.recipientEmail}</span> : null}</td>
                <td data-label="Value">{formatAed(c.initialAedMinor)}</td>
                <td data-label="Balance">{formatAed(c.balanceAedMinor)}</td>
                <td data-label="Expires">{c.expiresAt ? formatExpiry(c.expiresAt) : "-"}</td>
                <td data-label="Status">{c.status.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-8"><ExportLink kind="gift-cards" label="Gift cards CSV" /></div>
    </>
  );
}

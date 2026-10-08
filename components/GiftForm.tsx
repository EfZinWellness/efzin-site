"use client";

import { useState } from "react";
import { estimateLocal, formatMoney } from "@/lib/pricing/estimate";

export interface GiftExperienceOption {
  slug: string;
  title: string;
}

const PRESETS = [25000, 50000, 100000, 250000] as const;
const input = "w-full border-b border-navy/40 bg-transparent px-1 py-2 text-sm focus:border-navy focus:outline-none";
const label = "mt-5 block text-[10px] uppercase tracking-[0.2em] text-navy/80";
const section = "mt-10 text-[10px] uppercase tracking-[0.2em] text-navy/60";

type Outcome = { kind: "idle" | "sending" } | { kind: "error"; message: string };

function Field(p: {
  id: string;
  text: string;
  type?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  min?: string;
  max?: string;
}) {
  return (
    <div>
      <label htmlFor={p.id} className={label}>{p.text}</label>
      <input id={p.id} type={p.type ?? "text"} required={p.required} autoComplete={p.autoComplete} min={p.min} max={p.max}
        value={p.value} onChange={(e) => p.onChange(e.target.value)} className={input} />
    </div>
  );
}

export default function GiftForm(props: {
  experiences: GiftExperienceOption[];
  initialSlug: string | null;
  /** Dubai dates, YYYY-MM-DD. */
  today: string;
  latest: string;
  visitorCurrency: string | null;
  rates: Record<string, number>;
}) {
  const [preset, setPreset] = useState<number | "custom">(50000);
  const [customAed, setCustomAed] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [sendTo, setSendTo] = useState<"recipient" | "me">("recipient");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [deliverOn, setDeliverOn] = useState(props.today);
  const [suggested, setSuggested] = useState(props.initialSlug ?? "");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const customMinor = Math.round(Number(customAed) * 100);
  const amount = preset === "custom" ? customMinor : preset;
  const amountOk = Number.isFinite(amount) && amount >= 10000 && amount <= 1000000;
  const bulk = quantity > 1;
  const total = amountOk ? amount * quantity : 0;
  const local =
    total > 0 && props.visitorCurrency ? estimateLocal(total, "AED", props.visitorCurrency, props.rates) : null;

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!amountOk) return setOutcome({ kind: "error", message: "Choose a value between AED 100 and AED 10,000." });
    const website = String(new FormData(ev.currentTarget).get("website") ?? "");
    setOutcome({ kind: "sending" });
    try {
      const res = await fetch("/api/gift/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountAedMinor: amount,
          quantity,
          sendTo: bulk ? "me" : sendTo,
          recipientName: bulk || sendTo === "me" ? undefined : recipientName,
          recipientEmail: bulk || sendTo === "me" ? undefined : recipientEmail,
          message: bulk ? undefined : message,
          deliverOn: bulk ? undefined : deliverOn,
          suggestedSlug: suggested || undefined,
          buyerName,
          buyerEmail,
          website,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; errors?: string[]; message?: string };
      if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setOutcome({
        kind: "error",
        message: data.errors?.join(" ") ?? data.message ?? "Sorry, that did not go through. Please try again.",
      });
    } catch {
      setOutcome({ kind: "error", message: "Sorry, that did not go through. Please check your connection and try again." });
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="Gift card form" className="text-left">
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <h2 className="font-serif text-xl">Choose a value</h2>
      <div role="radiogroup" aria-label="Value" className="mt-3 grid grid-cols-2 gap-2">
        {PRESETS.map((p) => (
          <label key={p} className={`cursor-pointer border px-3 py-3 text-center text-sm ${preset === p ? "border-navy bg-white" : "border-sand bg-white/60"}`}>
            <input type="radio" name="amount" className="sr-only" checked={preset === p} onChange={() => setPreset(p)} />
            AED {(p / 100).toLocaleString("en-GB")}
          </label>
        ))}
        <label className={`col-span-2 cursor-pointer border px-3 py-3 text-center text-sm ${preset === "custom" ? "border-navy bg-white" : "border-sand bg-white/60"}`}>
          <input type="radio" name="amount" className="sr-only" checked={preset === "custom"} onChange={() => setPreset("custom")} />
          Custom amount
        </label>
      </div>
      {preset === "custom" ? (
        <Field id="g-custom" text="Amount in AED (100 to 10,000)" type="number" required value={customAed} onChange={setCustomAed} min="100" max="10000" />
      ) : null}

      <label htmlFor="g-for" className={label}>Suggest an experience (optional)</label>
      <select id="g-for" value={suggested} onChange={(e) => setSuggested(e.target.value)} className={input}>
        <option value="">Anything at Ef Zin</option>
        {props.experiences.map((e) => (
          <option key={e.slug} value={e.slug}>{e.title}</option>
        ))}
      </select>
      <p className="mt-2 text-xs text-navy/60">It appears on the card, but the card can be spent on anything.</p>

      <label htmlFor="g-qty" className={label}>How many cards?</label>
      <input id="g-qty" type="number" min={1} max={50} value={quantity}
        onChange={(e) => setQuantity(Math.min(50, Math.max(1, Math.floor(Number(e.target.value)) || 1)))} className={input} />
      {bulk ? (
        <p className="mt-2 text-xs text-navy/60">All the codes are emailed to you in one message, with a CSV. We do not email anyone else.</p>
      ) : null}

      {!bulk ? (
        <>
          <p className={section}>Personalise</p>
          <div role="radiogroup" aria-label="Who is it for?" className="mt-3 grid grid-cols-2 gap-2">
            {(
              [
                ["recipient", "Send to a friend"],
                ["me", "Send it to me"],
              ] as const
            ).map(([v, text]) => (
              <label key={v} className={`cursor-pointer border px-3 py-3 text-center text-sm ${sendTo === v ? "border-navy bg-white" : "border-sand bg-white/60"}`}>
                <input type="radio" name="sendTo" className="sr-only" checked={sendTo === v} onChange={() => setSendTo(v)} />
                {text}
              </label>
            ))}
          </div>
          {sendTo === "recipient" ? (
            <>
              <Field id="g-rname" text="Recipient's name" required value={recipientName} onChange={setRecipientName} />
              <Field id="g-remail" text="Recipient's email" type="email" required value={recipientEmail} onChange={setRecipientEmail} />
            </>
          ) : (
            <p className="mt-3 text-xs text-navy/60">You get the card by email, to print or forward.</p>
          )}
          <label htmlFor="g-msg" className={label}>Message (optional)</label>
          <textarea id="g-msg" rows={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} className={input} />
          <p className="text-right text-xs text-navy/60">{message.length}/300</p>
          <Field id="g-date" text="Deliver on" type="date" required value={deliverOn} onChange={setDeliverOn} min={props.today} max={props.latest} />
          <p className="mt-2 text-xs text-navy/60">Sent at 08:00 Dubai time on the day, up to 12 months ahead.</p>
        </>
      ) : null}

      <p className={section}>Your details</p>
      <Field id="g-bname" text="Your name" required autoComplete="name" value={buyerName} onChange={setBuyerName} />
      <Field id="g-bemail" text="Your email" type="email" required autoComplete="email" value={buyerEmail} onChange={setBuyerEmail} />

      <div className="mt-10 border-t border-sand/70 pt-5 text-sm">
        <p className="flex justify-between gap-3">
          <span>Total</span>
          <span data-testid="gift-total">
            {amountOk ? `AED ${(total / 100).toLocaleString("en-GB")}` : "-"}
            {local !== null && props.visitorCurrency ? ` ≈ ${formatMoney(local, props.visitorCurrency)}` : ""}
          </span>
        </p>
        <p className="mt-2 text-xs text-navy/60">Valid for 12 months on any event or retreat. You pay in your own currency at checkout.</p>
      </div>

      {outcome.kind === "error" ? <p role="alert" className="mt-4 text-sm text-oxblood">{outcome.message}</p> : null}
      <button type="submit" disabled={outcome.kind === "sending"} className="btn btn-solid mt-6 w-full">
        {outcome.kind === "sending" ? "One moment" : "Continue to payment"}
      </button>
    </form>
  );
}

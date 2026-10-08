"use client";

import { useState } from "react";

type Kind = "private" | "corporate" | "coaching" | "retreat_interest";

const INTERESTS: [string, string][] = [["move", "Move"], ["nourish", "Nourish"], ["thrive", "Thrive"]];
const CORPORATE_GOALS = ["Stress", "Team bonding", "Burnout", "Energy", "Something else"];

const input = "w-full border-b border-navy/40 bg-transparent px-1 py-2 text-sm focus:border-navy focus:outline-none";
const label = "mt-5 block text-[10px] uppercase tracking-[0.2em] text-navy/80";

function Field({ id, text, children }: { id: string; text: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
    </div>
  );
}

function Chips({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: [string, string][];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="mt-5">
      <legend className="text-[10px] uppercase tracking-[0.2em] text-navy/80">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([v, l]) => {
          const on = value.includes(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}
              className={`border border-navy px-4 py-2 text-xs ${on ? "bg-navy text-ivory" : ""}`}
            >
              {l}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function EnquiryForm({ type, slug }: { type: Kind; slug?: string }) {
  const [interests, setInterests] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [where, setWhere] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const bespoke = type === "private" || type === "corporate";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return v === "" ? undefined : v;
    };
    const num = (k: string) => {
      const v = text(k);
      return v === undefined ? undefined : Number(v);
    };

    const payload: Record<string, unknown> = {
      type,
      name: text("name"),
      email: text("email"),
      phone: text("phone"),
      notes: text("notes"),
      website: text("website"),
    };
    if (bespoke) {
      const amount = num("budgetAmount");
      Object.assign(payload, {
        whoFor: type === "corporate" ? "team" : text("whoFor"),
        occasion: text("occasion"),
        where: text("where"),
        groupSize: num("groupSize"),
        ageRange: text("ageRange"),
        interests,
        accommodation: text("accommodation"),
        budget: amount ? { amount, currency: text("budgetCurrency") ?? "AED", basis: text("budgetBasis") ?? "total" } : undefined,
        links: text("links"),
        preferredDates: text("preferredDates"),
      });
    }
    if (type === "corporate") {
      Object.assign(payload, {
        company: text("company"),
        teamSize: num("teamSize"),
        goals,
        invoiceContact: text("invoiceContact"),
      });
    }
    if (type === "coaching") Object.assign(payload, { format: text("format"), goals: text("goals") });
    if (type === "retreat_interest") Object.assign(payload, { slug, groupSize: num("groupSize") });

    setState("sending");
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("done");
    } catch {
      setState("idle");
      setError("Sorry, that did not go through. Please check your details and try again, or message us on WhatsApp.");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="border border-sand/70 bg-ivory p-6 text-center font-serif text-lg">
        Thank you. Tanya will be in touch personally within two working days.
      </p>
    );
  }

  const uid = `f-${type}`;
  const multiDay = where === "abroad_multi_day" || where === "flexible";

  return (
    <form onSubmit={onSubmit} className="text-left" aria-label="Enquiry form">
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <Field id={`${uid}-name`} text="Your name">
        <input id={`${uid}-name`} name="name" required autoComplete="name" className={input} />
      </Field>
      <Field id={`${uid}-email`} text="Email">
        <input id={`${uid}-email`} name="email" type="email" required autoComplete="email" className={input} />
      </Field>
      <Field id={`${uid}-phone`} text="Phone (optional)">
        <input id={`${uid}-phone`} name="phone" type="tel" autoComplete="tel" className={input} />
      </Field>

      {type === "corporate" ? (
        <>
          <Field id={`${uid}-company`} text="Company">
            <input id={`${uid}-company`} name="company" required className={input} />
          </Field>
          <Field id={`${uid}-team`} text="Team size">
            <input id={`${uid}-team`} name="teamSize" type="number" min={1} required inputMode="numeric" className={input} />
          </Field>
          <Chips
            legend="What would you like to improve?"
            options={CORPORATE_GOALS.map((g) => [g.toLowerCase(), g])}
            value={goals}
            onChange={setGoals}
          />
          <Field id={`${uid}-invoice`} text="Invoicing contact">
            <input id={`${uid}-invoice`} name="invoiceContact" required placeholder="Name and email" className={input} />
          </Field>
        </>
      ) : null}

      {type === "private" ? (
        <>
          <Field id={`${uid}-who`} text="Who is it for?">
            <select id={`${uid}-who`} name="whoFor" required defaultValue="" className={input}>
              <option value="" disabled>Choose</option>
              <option value="friends">Friends</option>
              <option value="family">Family</option>
              <option value="team">A corporate team</option>
              <option value="just_me">Just me</option>
            </select>
          </Field>
          <Field id={`${uid}-occ`} text="Celebrating anything special? (optional)">
            <select id={`${uid}-occ`} name="occasion" defaultValue="" className={input}>
              <option value="">Not especially</option>
              <option value="birthday">Birthday</option>
              <option value="bachelorette">Bachelorette</option>
              <option value="anniversary">Anniversary</option>
              <option value="other">Something else</option>
            </select>
          </Field>
        </>
      ) : null}

      {bespoke ? (
        <>
          <Field id={`${uid}-where`} text="Where and when">
            <select
              id={`${uid}-where`}
              name="where"
              required
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              className={input}
            >
              <option value="" disabled>Choose</option>
              <option value="dubai_half_day">Dubai, half day</option>
              <option value="dubai_full_day">Dubai, full day</option>
              <option value="abroad_multi_day">Greece or abroad, several days</option>
              <option value="flexible">Flexible dates</option>
            </select>
          </Field>
          <Field id={`${uid}-dates`} text="Preferred dates (optional)">
            <input id={`${uid}-dates`} name="preferredDates" maxLength={200} placeholder="e.g. a weekend in March" className={input} />
          </Field>
          {type === "private" ? (
            <Field id={`${uid}-size`} text="Group size">
              <input id={`${uid}-size`} name="groupSize" type="number" min={1} inputMode="numeric" className={input} />
            </Field>
          ) : null}
          <Field id={`${uid}-age`} text="Rough age range (optional)">
            <input id={`${uid}-age`} name="ageRange" placeholder="e.g. 30 to 45" className={input} />
          </Field>
          <Chips legend="What draws you in?" options={INTERESTS} value={interests} onChange={setInterests} />
          {multiDay ? (
            <Field id={`${uid}-acc`} text="Accommodation">
              <select id={`${uid}-acc`} name="accommodation" defaultValue="" className={input}>
                <option value="">Undecided</option>
                <option value="villa">Villa</option>
                <option value="boutique_hotel">Boutique hotel</option>
                <option value="sorted">Already sorted</option>
              </select>
            </Field>
          ) : null}
          <fieldset className="mt-5">
            <legend className="text-[10px] uppercase tracking-[0.2em] text-navy/80">Budget (optional)</legend>
            <div className="mt-2 grid grid-cols-[1fr_5rem] gap-3">
              <input name="budgetAmount" type="number" min={1} inputMode="numeric" aria-label="Budget amount" className={input} />
              <select name="budgetCurrency" aria-label="Currency" defaultValue="AED" className={input}>
                {["AED", "GBP", "EUR", "USD"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <select name="budgetBasis" aria-label="Budget basis" defaultValue="per_person" className={`${input} mt-2`}>
              <option value="per_person">Per person</option>
              <option value="total">In total</option>
            </select>
          </fieldset>
        </>
      ) : null}

      {type === "coaching" ? (
        <>
          <Field id={`${uid}-format`} text="How would you like to work together?">
            <select id={`${uid}-format`} name="format" defaultValue="" className={input}>
              <option value="">Not sure yet</option>
              <option value="in_person">In person</option>
              <option value="online">Online</option>
              <option value="hybrid">A mix of both</option>
            </select>
          </Field>
          <Field id={`${uid}-goals`} text="What would you like to change?">
            <textarea id={`${uid}-goals`} name="goals" rows={3} className={input} />
          </Field>
        </>
      ) : null}

      {type === "retreat_interest" ? (
        <Field id={`${uid}-size`} text="How many of you? (optional)">
          <input id={`${uid}-size`} name="groupSize" type="number" min={1} inputMode="numeric" className={input} />
        </Field>
      ) : null}

      <Field id={`${uid}-notes`} text="Anything else we should know?">
        <textarea id={`${uid}-notes`} name="notes" rows={4} className={input} />
      </Field>
      {bespoke ? (
        <Field id={`${uid}-links`} text="Inspiration links (optional)">
          <input id={`${uid}-links`} name="links" className={input} />
        </Field>
      ) : null}

      {error ? <p role="alert" className="mt-4 text-sm text-oxblood">{error}</p> : null}
      <button type="submit" disabled={state === "sending"} className="btn btn-solid mt-8 w-full">
        {state === "sending" ? "Sending" : type === "retreat_interest" ? "Send my interest" : "Send enquiry"}
      </button>
    </form>
  );
}
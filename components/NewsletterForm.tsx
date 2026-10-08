"use client";

import { useState } from "react";

export default function NewsletterForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const website = String(fd.get("website") ?? "");
    setState("sending");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, website }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return <p role="status" className="mt-6 text-sm">Thank you. You are on the list.</p>;
  }

  return (
    <form method="post" action="/api/newsletter" onSubmit={onSubmit} className="mx-auto mt-6 flex max-w-sm flex-col gap-3">
      <label htmlFor="nl-email" className="sr-only">Email address</label>
      <input
        id="nl-email"
        name="email"
        type="email"
        required
        placeholder="Your email"
        className="border-b border-ivory/60 bg-transparent px-1 py-2 text-sm text-ivory placeholder:text-ivory/60 focus:outline-none"
      />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <button type="submit" disabled={state === "sending"} className="btn">Subscribe</button>
      <p className="text-xs text-ivory/70">
        By subscribing you agree to receive occasional emails from Ef Zin. You can unsubscribe at any time.
      </p>
      {state === "error" ? <p role="alert" className="text-xs text-sand">Something went wrong. Please try again.</p> : null}
    </form>
  );
}
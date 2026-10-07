"use client";

import { useState } from "react";

export default function NewsletterForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setState("sending");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
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
      <button type="submit" disabled={state === "sending"} className="btn">Subscribe</button>
      {state === "error" ? <p role="alert" className="text-xs text-sand">Something went wrong. Please try again.</p> : null}
    </form>
  );
}
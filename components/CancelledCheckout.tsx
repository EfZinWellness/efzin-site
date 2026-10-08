"use client";

import { useEffect } from "react";

/** Shown after returning from Stripe Checkout with "back": frees the held spots so the guest can retry. */
export default function CancelledCheckout({
  pendingId,
  release,
}: {
  pendingId: string;
  release: (pendingId: string) => Promise<void>;
}) {
  useEffect(() => {
    void release(pendingId);
  }, [pendingId, release]);
  return (
    <p role="status" className="mt-6 border border-navy/20 px-4 py-3 text-sm text-navy/80">
      Checkout cancelled. Nothing was charged, and you can book again below.
    </p>
  );
}

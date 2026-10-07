"use client";

import { useBookPanel } from "./BookPanel";

export default function BookButton() {
  const { open } = useBookPanel();
  return (
    <button
      type="button"
      onClick={open}
      className="inline-block bg-navy px-4 py-2.5 text-[10px] uppercase tracking-[0.22em] text-ivory"
    >
      Book
    </button>
  );
}
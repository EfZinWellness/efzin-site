"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "./Logo";
import BookButton from "./BookButton";

const LEFT = ["Events", "Retreats", "Bespoke"];
const RIGHT = ["Coaching", "Journal", "About"];
const linkClass = "text-[10px] uppercase tracking-[0.2em]";
const href = (label: string) => `/${label.toLowerCase()}`;

function AccountIcon() {
  return (
    <Link href="/account" aria-label="Account">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </Link>
  );
}

export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="relative border-b border-sand/60 text-choc">
      <nav aria-label="Main" className="flex items-center justify-between px-4 py-5 md:grid md:grid-cols-[1fr_auto_1fr] md:px-12">
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
          className="md:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 7h18M3 12h18M3 17h18" />
          </svg>
        </button>

        <ul className="hidden gap-8 md:flex">
          {LEFT.map((l) => (
            <li key={l}><Link href={href(l)} className={linkClass}>{l}</Link></li>
          ))}
        </ul>

        <Logo />

        <div className="flex items-center gap-4 md:justify-end md:gap-8">
          <ul className="hidden gap-8 md:flex">
            {RIGHT.map((l) => (
              <li key={l}><Link href={href(l)} className={linkClass}>{l}</Link></li>
            ))}
          </ul>
          <AccountIcon />
          <BookButton />
        </div>
      </nav>

      <ul
        id="mobile-menu"
        hidden={!open}
        className="flex flex-col gap-4 border-t border-sand/60 bg-ivory px-4 py-5 md:hidden"
      >
        {[...LEFT, ...RIGHT].map((l) => (
          <li key={l}>
            <Link href={href(l)} onClick={() => setOpen(false)} className={linkClass}>{l}</Link>
          </li>
        ))}
      </ul>
    </header>
  );
}

"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface PanelItem {
  slug: string;
  title: string;
  when: string;
  href: string;
  price: ReactNode;
  spotsLabel: string | null;
}

const Ctx = createContext<{ open: () => void }>({ open: () => {} });
export const useBookPanel = () => useContext(Ctx);

/** Wraps the site; renders the quick-book dialog and lets <BookButton/> open it. */
export function BookPanelProvider({ items, children }: { items: PanelItem[]; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (isOpen && !d.open) d.showModal();
    if (!isOpen && d.open) d.close();
  }, [isOpen]);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <dialog
        ref={ref}
        aria-labelledby="book-panel-title"
        onClose={() => setIsOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setIsOpen(false);
        }}
        className="m-0 ml-auto h-full max-h-none w-full max-w-md bg-ivory p-0 text-navy backdrop:bg-navy/40"
      >
        <div className="flex h-full flex-col px-5 py-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="greek text-sm">εὖ ζῆν</p>
              <h2 id="book-panel-title" className="mt-1 font-serif text-2xl">Book your place</h2>
            </div>
            <button type="button" aria-label="Close" onClick={() => setIsOpen(false)} className="p-2 text-xl leading-none">
              ×
            </button>
          </div>

          {items.length === 0 ? (
            <p className="mt-8 text-sm text-stone">
              Nothing is open for booking right now. See what is coming up on the{" "}
              <Link href="/events" onClick={() => setIsOpen(false)} className="underline underline-offset-4">
                events page
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-sand/60 overflow-y-auto border-y border-sand/60">
              {items.map((it) => (
                <li key={it.slug} data-testid="panel-item">
                  <Link
                    href={it.href}
                    onClick={() => setIsOpen(false)}
                    className="flex items-center justify-between gap-4 py-4"
                  >
                    <span className="min-w-0">
                      <span className="eyebrow block text-teal">{it.when}</span>
                      <span className="mt-1 block font-serif text-lg leading-snug">{it.title}</span>
                      <span className="mt-1 block text-sm">{it.price}</span>
                      {it.spotsLabel ? <span className="mt-1 block text-xs text-teal">{it.spotsLabel}</span> : null}
                    </span>
                    <span aria-hidden="true" className="text-xl">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/events"
            onClick={() => setIsOpen(false)}
            className="eyebrow mt-auto pt-6 text-center underline underline-offset-4"
          >
            See everything on
          </Link>
        </div>
      </dialog>
    </Ctx.Provider>
  );
}
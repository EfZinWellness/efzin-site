import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Upcoming" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/requests", label: "Requests" },
  { href: "/admin/gift-cards", label: "Gift cards" },
  { href: "/admin/payments", label: "Payments due" },
];

/** Admin section links; wraps on a phone. */
export default function AdminNav() {
  return (
    <nav aria-label="Admin" className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-y border-sand/60 py-3">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="text-[10px] uppercase tracking-[0.2em] text-navy/80 underline-offset-4 hover:underline">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

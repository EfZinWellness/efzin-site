import Link from "next/link";
import { signOut } from "@/app/account/auth-actions";

const LINKS = [
  { href: "/account", label: "Bookings" },
  { href: "/account/gift-cards", label: "Gift cards" },
  { href: "/account/health", label: "Health details" },
  { href: "/account/profile", label: "Profile" },
];

/** Member area links (wraps on a phone) and sign out. */
export default function AccountNav({ current }: { current: string }) {
  return (
    <nav aria-label="My Ef Zin" className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-y border-sand/60 py-3">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={current === l.href ? "page" : undefined}
          className={`text-[10px] uppercase tracking-[0.2em] ${current === l.href ? "underline underline-offset-4" : "text-navy/70"}`}
        >
          {l.label}
        </Link>
      ))}
      <form action={signOut}>
        <button type="submit" className="text-[10px] uppercase tracking-[0.2em] text-navy/70">Sign out</button>
      </form>
    </nav>
  );
}

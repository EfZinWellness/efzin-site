import Link from "next/link";

// Plain link for now; a later task turns this into the booking panel trigger.
export default function BookButton() {
  return (
    <Link
      href="/events"
      className="inline-block bg-navy px-4 py-2.5 text-[10px] uppercase tracking-[0.22em] text-ivory"
    >
      Book
    </Link>
  );
}

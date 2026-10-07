import Link from "next/link";

// Text wordmark until the logo file is supplied; swap the span for an <Image>.
export default function Logo() {
  return (
    <Link href="/" aria-label="Ef Zin home" className="font-serif text-xl tracking-[0.18em] sm:text-2xl">
      EF ζIN
    </Link>
  );
}

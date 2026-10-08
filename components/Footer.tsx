import Link from "next/link";
import Logo from "./Logo";

const LINKS = [
  ["Gift cards", "/gift"],
  ["FAQ", "/faq"],
  ["Contact", "/contact"],
  ["Terms", "/terms"],
  ["Privacy", "/privacy"],
] as const;

export default function Footer() {
  return (
    <footer className="bg-olive px-4 py-10 text-center text-ivory">
      <Logo />
      <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
        {LINKS.map(([label, to]) => (
          <li key={label}>
            <Link href={to} className="text-[10px] uppercase tracking-[0.2em]">{label}</Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-xs text-sage">
        <a href="mailto:contact@efzinwellness.com">contact@efzinwellness.com</a>
      </p>
    </footer>
  );
}

import Image from "next/image";
import Link from "next/link";

const SRC = {
  navy: "/brand/wordmark-navy.png",
  ivory: "/brand/wordmark-ivory.png",
} as const;

// Trimmed wordmark files are 1200x366.
export default function Logo({ variant = "navy" }: { variant?: "navy" | "ivory" }) {
  return (
    <Link href="/" aria-label="Ef Zin home" className="inline-flex items-center">
      <Image
        src={SRC[variant]}
        alt="Ef Zin"
        width={1200}
        height={366}
        priority
        className="h-6 w-auto sm:h-8"
      />
    </Link>
  );
}

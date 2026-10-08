/** 32 symbols, no I, O, 0 or 1. 32 divides 256 so `byte % 32` is unbiased. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GIFT_RE = /^EFZG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function generateGiftCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % 32];
  return `EFZG-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normaliseCode(input: string): string {
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  if (s.startsWith("EFZG") && s.length === 12) return `EFZG-${s.slice(4, 8)}-${s.slice(8)}`;
  if (s.startsWith("EFZ") && s.length === 9) return `EFZ-${s.slice(3)}`;
  return s;
}

export function isGiftCode(code: string): boolean {
  return GIFT_RE.test(code);
}

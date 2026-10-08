import { describe, expect, it } from "vitest";
import { generateGiftCode, isGiftCode, normaliseCode } from "../../lib/giftcards/code";

describe("gift codes", () => {
  it("generates the EFZG format", () => {
    const code = generateGiftCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37 + 5));
    expect(code).toMatch(/^EFZG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(isGiftCode(code)).toBe(true);
  });
  it("maps bytes with modulo 32", () => {
    expect(generateGiftCode(() => new Uint8Array(8))).toBe("EFZG-AAAA-AAAA");
    expect(generateGiftCode(() => new Uint8Array(8).fill(255))).toBe("EFZG-9999-9999");
  });
  it("normalises gift codes", () => {
    expect(normaliseCode(" efzg abcd 2345 ")).toBe("EFZG-ABCD-2345");
    expect(normaliseCode("efz-ab12cd")).toBe("EFZ-AB12CD");
    expect(normaliseCode("  xyz 12 ")).toBe("XYZ12");
  });
  it("rejects non-gift codes", () => {
    expect(isGiftCode("EFZ-AB12CD")).toBe(false);
  });
});

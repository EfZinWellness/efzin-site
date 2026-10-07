import type { PolicyTemplate } from "./types";

/** Guest-facing policy bullets (spec section 9). */
export function policyCopy(template: PolicyTemplate): string[] {
  if (template === "standard_event") {
    return [
      "More than 48 hours before the start: full refund (minus Stripe processing fees) or full-value credit, your choice.",
      "Within 48 hours of the start: credit only.",
      "No-show: no refund or credit.",
      "Transfer your place to a friend for free, up to 2 hours before the start.",
      "If Ef Zin cancels: full refund, or transfer to a future experience, your choice.",
      "Credit is held in AED, usable on any event or retreat, and expires 12 months after it is issued.",
    ];
  }
  return [
    "More than 60 days before arrival: full refund of amounts paid, minus Stripe processing fees.",
    "30 to 60 days before arrival: we refund anything you have paid above 50% of the total retreat price, minus Stripe processing fees.",
    "Within 30 days of arrival: no refund; you may transfer your place to another person.",
    "Payment plan balance is due 10 days before arrival; a missed payment cancels the booking under these rules.",
    "If Ef Zin cancels: full refund, or transfer to a future experience, your choice.",
    "Credit is held in AED, usable on any event or retreat, and expires 12 months after it is issued.",
  ];
}
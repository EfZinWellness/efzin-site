export type PolicyTemplate = "standard_event" | "standard_retreat";

export type CancelOption =
  | { kind: "refund"; ratio: number; deductFees: boolean }
  | { kind: "credit"; amountAedMinor: number }
  | { kind: "transfer" };

export interface PolicyInput {
  template: PolicyTemplate;
  startsAt: Date;
  now: Date;
  amountPaidBaseMinor: number;
  totalPriceBaseMinor: number;
  amountPaidAedMinor: number;
  cancelledBy: "guest" | "efzin";
}

export type Pillar = "move" | "nourish" | "thrive";

export const PILLARS: Record<Pillar, { label: string; greek: string; blurb: string }> = {
  move: {
    label: "Move",
    greek: "Κίνηση",
    blurb: "Yoga, breath and strength, practised slowly and with intention.",
  },
  nourish: {
    label: "Nourish",
    greek: "Διατροφή",
    blurb: "Honest, seasonal food, shared at a long table.",
  },
  thrive: {
    label: "Thrive",
    greek: "Ευημερία",
    blurb: "Rest, stillness and connection, so that wellbeing can take root.",
  },
};
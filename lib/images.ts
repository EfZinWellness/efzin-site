/** Site photos, stored in public/images (migrated from the old Squarespace site by scripts/download-images.ts). */
export const PHOTOS = {
  hero: "retreat-yoga-pool-ocean.jpg",
  retreatCard: "retreat-yoga-mountain-views.jpg",
  move: "pillar-move-mats-outdoors.jpg",
  nourish: "pillar-nourish-beach-fruit.jpg",
  thrive: "retreat-singing-bowl.jpg",
  founder: "founder-tanya-pouring-water.jpg",
  bespoke: "retreat-group-yoga-pool.jpg",
  corporate: "corporate-rooftop-yoga-coast.jpg",
} as const;

export const INSTAGRAM_GRID = [
  "retreat-yoga-pool.jpg",
  "retreat-group-yoga-outdoors.jpg",
  "event-outdoor-yoga-musician.jpg",
  "event-outdoor-yoga-class.jpg",
  "instagram-pushup-on-mat.jpg",
  "instagram-face-painting-ritual.jpg",
] as const;

/**
 * URL for a photo file name. The second argument is kept for existing callers;
 * next/image picks the delivered size, so it is ignored. A path that is already absolute is returned as is.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function photo(file: string, _width?: number): string {
  return file.startsWith("/") || file.startsWith("http") ? file : `/images/${file}`;
}

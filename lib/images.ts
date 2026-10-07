const BASE = "https://images.squarespace-cdn.com/content/v1/677bb90cc220295a8af20de1/";

/** Photo ids from the current Squarespace site (see photos list). */
export const PHOTOS = {
  hero: "662033f2-d6b2-43a7-b98f-01e2f3b70a6c/AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-54.JPG",
  retreatCard: "3622c356-7146-401e-843a-6a9a571c08a3/AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-182+2.JPG",
  move: "1dd5d012-eb8b-4a42-8972-fb13e263557c/Final+Content_Images+Edited_DSC05283.jpg",
  nourish: "d6f73f0c-e45d-4d99-bca1-b51ff996a237/UNADJUSTEDNONRAW_thumb_139e8.jpg",
  thrive: "ab5e60a4-ad94-47e2-b418-d168e58f4b90/AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-222.JPG",
  founder: "434dadb1-e90f-49c5-947f-5754e4ec6121/UNADJUSTEDNONRAW_thumb_139ed.jpg",
  bespoke: "6bbae921-bf48-4c77-b675-8e71b1484bc8/AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-32+2.JPG",
  corporate: "96accdcb-0caa-43b9-9247-e394239bd4ba/UNADJUSTEDNONRAW_mini_13219.jpg",
} as const;

export const INSTAGRAM_GRID = [
  "46bd5581-5937-4a45-acc1-e741db0892df/AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-40+2.JPG",
  "f4f63d7e-1879-4020-b2aa-93f7e9ccd385/AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-43+2.JPG",
  "23eafd49-756f-494b-b3e8-314ea5358b4d/Launch_Edited+Images_DSC06490.jpg",
  "dd98f027-4ef9-4f97-9ffb-d11820edeec4/Launch_Edited+Images_DSC06558.jpg",
  "81147837-0761-4ea7-af92-c5bc5e56cb56/UNADJUSTEDNONRAW_mini_13195.jpg",
  "11e2d777-cb2e-4f21-a4f3-954b2413ceab/IMG_3616+2.JPG",
] as const;

export function photo(id: string, width = 1500): string {
  return `${BASE}${id}?format=${width}w`;
}
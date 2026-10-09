/**
 * One-off migration helper: downloads every image from the old Squarespace site into public/images/
 * (max 2000px wide, JPEG quality 82), then rewrites repo references from the Squarespace CDN to /images/....
 *
 *   npx tsx scripts/download-images.ts
 *
 * Safe to rerun: existing files are kept, and files that no longer mention the CDN are untouched.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "images");
const BASE = "https://images.squarespace-cdn.com/content/v1/677bb90cc220295a8af20de1/";

/** Squarespace asset id (the uuid folder) -> descriptive local file name. */
const NAMES: Record<string, string> = {
  "662033f2-d6b2-43a7-b98f-01e2f3b70a6c": "retreat-yoga-pool-ocean",
  "46bd5581-5937-4a45-acc1-e741db0892df": "retreat-yoga-pool",
  "6bbae921-bf48-4c77-b675-8e71b1484bc8": "retreat-group-yoga-pool",
  "f4f63d7e-1879-4020-b2aa-93f7e9ccd385": "retreat-group-yoga-outdoors",
  "3622c356-7146-401e-843a-6a9a571c08a3": "retreat-yoga-mountain-views",
  "ab5e60a4-ad94-47e2-b418-d168e58f4b90": "retreat-singing-bowl",
  "1dd5d012-eb8b-4a42-8972-fb13e263557c": "pillar-move-mats-outdoors",
  "d6f73f0c-e45d-4d99-bca1-b51ff996a237": "pillar-nourish-beach-fruit",
  "434dadb1-e90f-49c5-947f-5754e4ec6121": "founder-tanya-pouring-water",
  "1f742461-132b-4bd7-806f-6535531f1b68": "event-re-recovery-hero",
  "ed9ad354-7d0c-4d23-b41c-c11b4c105ff4": "event-re-wellness-1",
  "a120293f-bf6d-4984-9735-70e41bf1517f": "event-re-wellness-2",
  "46ee1c64-4569-435f-a83d-eaf923822d0c": "event-re-wellness-3",
  "cee95ff2-0b76-4c40-99cc-5505f733ec4b": "event-flow-create-bridge-pose",
  "23eafd49-756f-494b-b3e8-314ea5358b4d": "event-outdoor-yoga-musician",
  "dd98f027-4ef9-4f97-9ffb-d11820edeec4": "event-outdoor-yoga-class",
  "96accdcb-0caa-43b9-9247-e394239bd4ba": "corporate-rooftop-yoga-coast",
  "81147837-0761-4ea7-af92-c5bc5e56cb56": "instagram-pushup-on-mat",
  "11e2d777-cb2e-4f21-a4f3-954b2413ceab": "instagram-face-painting-ritual",
};

/** Squarespace file names (the part after the id) for the verified list, so every image is fetched even when no repo file spells out its full URL. */
const FILES: Record<string, string> = {
  "662033f2-d6b2-43a7-b98f-01e2f3b70a6c": "AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-54.JPG",
  "46bd5581-5937-4a45-acc1-e741db0892df": "AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-40+2.JPG",
  "6bbae921-bf48-4c77-b675-8e71b1484bc8": "AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-32+2.JPG",
  "f4f63d7e-1879-4020-b2aa-93f7e9ccd385": "AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-43+2.JPG",
  "3622c356-7146-401e-843a-6a9a571c08a3": "AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-182+2.JPG",
  "ab5e60a4-ad94-47e2-b418-d168e58f4b90": "AEGEAN_SOULSEARCHRETREAT_DAY1_AA_-222.JPG",
  "1dd5d012-eb8b-4a42-8972-fb13e263557c": "Final+Content_Images+Edited_DSC05283.jpg",
  "d6f73f0c-e45d-4d99-bca1-b51ff996a237": "UNADJUSTEDNONRAW_thumb_139e8.jpg",
  "434dadb1-e90f-49c5-947f-5754e4ec6121": "UNADJUSTEDNONRAW_thumb_139ed.jpg",
  "1f742461-132b-4bd7-806f-6535531f1b68": "Copy+of+Re+-078.jpg",
  "ed9ad354-7d0c-4d23-b41c-c11b4c105ff4": "Copy+of+Re+Wellness-080.jpg",
  "a120293f-bf6d-4984-9735-70e41bf1517f": "Copy+of+Re+-036.jpg",
  "46ee1c64-4569-435f-a83d-eaf923822d0c": "Copy+of+Re+-051.jpg",
  "cee95ff2-0b76-4c40-99cc-5505f733ec4b": "Launch_Edited+Images_DSC06523.jpg",
  "23eafd49-756f-494b-b3e8-314ea5358b4d": "Launch_Edited+Images_DSC06490.jpg",
  "dd98f027-4ef9-4f97-9ffb-d11820edeec4": "Launch_Edited+Images_DSC06558.jpg",
  "96accdcb-0caa-43b9-9247-e394239bd4ba": "UNADJUSTEDNONRAW_mini_13219.jpg",
  "81147837-0761-4ea7-af92-c5bc5e56cb56": "UNADJUSTEDNONRAW_mini_13195.jpg",
  "11e2d777-cb2e-4f21-a4f3-954b2413ceab": "IMG_3616+2.JPG",
};

const CDN_URL = /https:\/\/images\.squarespace-cdn\.com\/content\/v1\/[0-9a-f]+\/([0-9a-f-]{36})\/([^\s"'`)?]+)(\?[^\s"'`)]*)?/g;
const SCAN_DIRS = ["content", "app", "components", "lib"];
const SCAN_EXT = /\.(ya?ml|md|mdx|tsx?|json|css)$/;

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (SCAN_EXT.test(e.name)) out.push(p);
  }
  return out;
}

function localName(id: string, file: string): string {
  const known = NAMES[id];
  if (known) return known;
  const stem = decodeURIComponent(file.replace(/\+/g, " ")).replace(/\.[a-z0-9]+$/i, "");
  return "site-" + stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function download(id: string, file: string, name: string): Promise<void> {
  const dest = path.join(OUT_DIR, `${name}.jpg`);
  try {
    await fs.access(dest);
    return;
  } catch {
    /* not downloaded yet */
  }
  const url = `${BASE}${id}/${file}?format=2500w`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await sharp(buf)
    .rotate()
    .resize({ width: 2000, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(dest);
  console.log(`saved public/images/${name}.jpg`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // 1. The verified list, plus any other CDN URL mentioned anywhere in the repo.
  const files = (await Promise.all(SCAN_DIRS.map((d) => walk(path.join(ROOT, d))))).flat();
  const found = new Map<string, string>(Object.entries(FILES)); // id -> file name
  for (const f of files) {
    for (const m of (await fs.readFile(f, "utf8")).matchAll(CDN_URL)) if (!found.has(m[1])) found.set(m[1], m[2]);
  }

  for (const [id, file] of found) await download(id, file, localName(id, file));

  // 2. Rewrite references.
  for (const f of files) {
    const text = await fs.readFile(f, "utf8");
    const next = text.replace(CDN_URL, (_m, id: string, file: string) => `/images/${localName(id, file)}.jpg`);
    if (next !== text) {
      await fs.writeFile(f, next, "utf8");
      console.log(`rewrote ${path.relative(ROOT, f)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// One-off: trim and resize the owner-supplied brand PNGs into public/brand and app/icon.png.
// Usage: node scripts/prepare-brand-assets.mjs
import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const SRC = "C:\\Users\\tanya.malhas\\OneDrive - Accenture\\Claude Code\\EFZIN\\EFZINbranding\\Branding\\Logos";
const OUT = path.resolve("public", "brand");
const IVORY = "#FFFDF1";

const files = [
  ["Logo/BLUE.png", "wordmark-navy.png"],
  ["Logo/IVORY.png", "wordmark-ivory.png"],
  ["Logo/BROWN.png", "wordmark-choc.png"],
  ["Logo Mark/EF ZIN BRANDING UPDATE.png", "mark-choc.png"],
  ["Logo Mark/IVORY.png", "mark-ivory.png"],
];

async function trimmed(file) {
  // limitInputPixels raised: sources are 8000x4500.
  const buf = await sharp(path.join(SRC, file), { limitInputPixels: false })
    .trim()
    .toBuffer();
  return buf;
}

await mkdir(OUT, { recursive: true });

for (const [src, dest] of files) {
  const buf = await trimmed(src);
  const out = path.join(OUT, dest);
  const info = await sharp(buf)
    .resize({ width: 1200, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true })
    .toFile(out);
  const kb = ((await stat(out)).size / 1024).toFixed(1);
  console.log(`${dest}: ${info.width}x${info.height}, ${kb} KB`);
}

// Square 512x512 site icon: chocolate mark centred on ivory.
const mark = await trimmed("Logo Mark/EF ZIN BRANDING UPDATE.png");
const inner = await sharp(mark)
  .resize({ width: 352, height: 352, fit: "inside" })
  .toBuffer();
const iconPath = path.resolve("app", "icon.png");
await sharp({ create: { width: 512, height: 512, channels: 4, background: IVORY } })
  .composite([{ input: inner, gravity: "centre" }])
  .png({ compressionLevel: 9 })
  .toFile(iconPath);
console.log(`app/icon.png: 512x512, ${((await stat(iconPath)).size / 1024).toFixed(1)} KB`);

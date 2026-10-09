import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("local images", () => {
  it("no content, app, components or lib file references the Squarespace CDN", () => {
    const root = process.cwd();
    const offenders = ["content", "app", "components", "lib"]
      .flatMap((d) => walk(join(root, d)))
      .filter((f) => /\.(ya?ml|md|mdx|tsx?|json|css)$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("images.squarespace-cdn.com"));
    expect(offenders).toEqual([]);
  });

  it("every /images/... reference resolves to a file in public/images", () => {
    const root = process.cwd();
    const missing: string[] = [];
    const files = ["content", "app", "components", "lib"].flatMap((d) => walk(join(root, d)));
    for (const f of files.filter((p) => /\.(ya?ml|md|mdx|tsx?|json|css)$/.test(p))) {
      for (const m of readFileSync(f, "utf8").matchAll(/\/images\/([A-Za-z0-9._-]+\.[a-z0-9]+)/g)) {
        if (!existsSync(join(root, "public", "images", m[1]))) missing.push(`${f}: ${m[0]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every photo named in lib/images and page frontmatter exists", async () => {
    const root = process.cwd();
    const { PHOTOS, INSTAGRAM_GRID } = await import("../../lib/images");
    const names: string[] = [...Object.values(PHOTOS), ...INSTAGRAM_GRID];
    for (const f of walk(join(root, "content", "pages"))) {
      const m = readFileSync(f, "utf8").match(/^image:\s*"?([^"\n]+)"?\s*$/m);
      if (m) names.push(m[1]);
    }
    expect(names.filter((n) => !existsSync(join(root, "public", "images", n)))).toEqual([]);
  });

  it("next.config does not allow the Squarespace CDN", () => {
    expect(readFileSync(join(process.cwd(), "next.config.ts"), "utf8")).not.toContain("squarespace");
  });
});

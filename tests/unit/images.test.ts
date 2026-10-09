import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

  it("next.config does not allow the Squarespace CDN", () => {
    expect(readFileSync(join(process.cwd(), "next.config.ts"), "utf8")).not.toContain("squarespace");
  });
});

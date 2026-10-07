import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { ExperienceSchema, type Experience } from "./schema";

const CONTENT_DIR = path.join(process.cwd(), "content");

export type ExperienceStatus = Experience["status"];

export async function loadExperiences(): Promise<Experience[]> {
  const dir = path.join(CONTENT_DIR, "experiences");
  const files = (await fs.readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  const out: Experience[] = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(dir, f), "utf8");
    const parsed = ExperienceSchema.safeParse(parseYaml(raw));
    if (!parsed.success) {
      throw new Error(`Invalid experience file ${f}: ${parsed.error.message}`);
    }
    out.push(parsed.data);
  }
  return out;
}

export async function loadExperience(slug: string): Promise<Experience | null> {
  const all = await loadExperiences();
  return all.find((e) => e.slug === slug) ?? null;
}

/** When the experience has ended the site treats it as past, whatever the file says. */
export function effectiveStatus(e: Experience, now: Date): ExperienceStatus {
  return Date.parse(e.endsAt) < now.getTime() ? "past" : e.status;
}

export function upcoming(list: Experience[], now: Date): Experience[] {
  return list
    .filter(
      (e) =>
        (e.status === "on_sale" || e.status === "sold_out" || e.status === "interest") &&
        Date.parse(e.endsAt) > now.getTime(),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export interface MdDoc {
  slug: string;
  data: Record<string, unknown>;
  body: string;
}

async function readMd(file: string, slug: string): Promise<MdDoc> {
  const raw = await fs.readFile(file, "utf8");
  const { data, content } = matter(raw);
  return { slug, data, body: content };
}

export async function loadPage(name: string): Promise<MdDoc> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid page name: ${name}`);
  return readMd(path.join(CONTENT_DIR, "pages", `${name}.mdx`), name);
}

export async function loadJournal(): Promise<MdDoc[]> {
  const dir = path.join(CONTENT_DIR, "journal");
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".mdx")).sort().reverse();
  } catch {
    return [];
  }
  return Promise.all(files.map((f) => readMd(path.join(dir, f), f.replace(/\.mdx$/, ""))));
}

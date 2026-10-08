import { Facts, Layout, P } from "./Layout";
import type { Data } from "./helpers";

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const label = (k: string): string => k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/** Every field of the data as a list: for Tanya's notes, whose data varies by caller. */
export function AdminFacts({ data, omit = [] }: { data: Data; omit?: string[] }) {
  const rows = Object.entries(data)
    .filter(([k]) => !omit.includes(k))
    .map(([k, v]): [string, string] => [label(k), show(v)]);
  return <Facts rows={rows} />;
}

/** A complete admin email: a title, an optional lead sentence and every field. */
export function AdminEmail({ title, lead, data, omit }: { title: string; lead?: string; data: Data; omit?: string[] }) {
  return (
    <Layout preview={lead || title} title={title}>
      {lead ? <P>{lead}</P> : null}
      <AdminFacts data={data} omit={omit} />
    </Layout>
  );
}

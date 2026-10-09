import { adminPerson } from "@/lib/auth/admin";
import { CSV_BOM } from "@/lib/admin/csv";
import { buildExport } from "@/lib/admin/export";
import { getSqlClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404 });

/** CSV download. 404 for everybody who is not an admin; health columns only for `guests-health`. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await adminPerson())) return notFound();
  const { kind } = await params;
  const db = await getSqlClient();
  if (!db) return notFound();
  const slug = new URL(request.url).searchParams.get("experience");
  const out = await buildExport(db, kind, { slug });
  if (!out) return notFound();
  return new Response(CSV_BOM + out.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

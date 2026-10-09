import type { Metadata } from "next";
import AdminNav from "@/components/admin/AdminNav";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = { title: "Admin | Ef Zin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Each page checks again (layouts are not re-run on every navigation).
  await requireAdmin();
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-10">
      <p className="text-center eyebrow text-stone">Admin</p>
      <AdminNav />
      {children}
    </div>
  );
}

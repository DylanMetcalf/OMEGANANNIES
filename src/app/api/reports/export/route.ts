import { sql } from "drizzle-orm";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

/** CSV export for authorised staff. Excludes children's data and contact details by design. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || !can(u, "reports.view")) return new Response("Not found", { status: 404 });
  const p = new URL(req.url).searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(p.get("from") ?? "") ? p.get("from")! : "2000-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(p.get("to") ?? "") ? p.get("to")! : "2100-01-01";
  const rows = (await db.execute(sql`
    SELECT b.reference, b.status, b.service_code, b.source, b.start_date, b.end_date, f.display_name AS family, n.display_name AS nanny,
      (SELECT total_minor FROM quotations q WHERE q.id = b.accepted_quotation_id) AS agreed_total_minor,
      (SELECT coalesce(sum(paid_minor),0) FROM invoices i WHERE i.booking_id = b.id) AS paid_minor, b.created_at
    FROM bookings b LEFT JOIN families f ON f.id = b.family_id LEFT JOIN nannies n ON n.id = b.nanny_id
    WHERE b.created_at::date BETWEEN ${from} AND ${to} ${p.get("service") ? sql`AND b.service_code = ${p.get("service")}` : sql``} ORDER BY b.created_at`)).rows as Record<string, unknown>[];
  const cols = ["reference", "status", "service_code", "source", "start_date", "end_date", "family", "nanny", "agreed_total_minor", "paid_minor", "created_at"];
  const cell = (v: unknown) => { const x = v instanceof Date ? v.toISOString() : String(v ?? ""); return /^[=+\-@]/.test(x) ? `"'${x.replace(/"/g, '""')}"` : `"${x.replace(/"/g, '""')}"`; };
  await audit(u.id, "report.export", "bookings", null, { from, to, rows: rows.length });
  return new Response([cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="omega-bookings-${from}-${to}.csv"`, "Cache-Control": "no-store" } });
}

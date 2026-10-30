import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";

const cell = (v: unknown) => { const t = String(v ?? ""); const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; return `"${safe.replace(/"/g, '""')}"`; };
/** Referral export for management: household names and statuses only — no emails, phones or children's data. */
export async function GET() {
  const u = await getCurrentUser();
  if (!u || !can(u, "reports.view")) return new Response("Not found", { status: 404 });
  const rows = await db.select({ r: s.referrals, code: s.referralCodes.code, referrer: s.families.displayName }).from(s.referrals).innerJoin(s.referralCodes, eq(s.referralCodes.id, s.referrals.codeId)).innerJoin(s.families, eq(s.families.id, s.referralCodes.familyId)).orderBy(desc(s.referrals.createdAt)).limit(5000);
  await audit(u.id, "report.export", "report", "growth", { rows: rows.length });
  const csv = [["referrer_household", "code", "joined", "status", "flags", "decided"].join(","), ...rows.map(({ r, code, referrer }) => [referrer, code, r.createdAt.toISOString().slice(0, 10), r.status, r.flags.join(" "), r.decidedAt?.toISOString().slice(0, 10) ?? ""].map(cell).join(","))].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=omega-referrals.csv", "Cache-Control": "no-store" } });
}

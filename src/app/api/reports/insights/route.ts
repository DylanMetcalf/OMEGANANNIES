import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { insights } from "@/lib/insights";
import { can } from "@/lib/permissions";

const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** Aggregated insights export (metric, value). No personal data. Commercial rows only with the payments permission. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || !can(u, "reports.view")) return new Response("Not found", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const f = { from: isDate(sp.get("from")) ? sp.get("from")! : new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10), to: isDate(sp.get("to")) ? sp.get("to")! : new Date().toISOString().slice(0, 10), service: sp.get("service") || undefined, area: sp.get("area") || undefined, status: sp.get("status") || undefined, nannyId: /^[0-9a-f-]{36}$/.test(sp.get("nanny") ?? "") ? sp.get("nanny")! : undefined };
  const d = await insights(f);
  const rows: [string, string, unknown][] = [
    ...Object.entries(d.ov).map(([k, v]) => ["overview", k, v] as [string, string, unknown]),
    ["bookings", "lead_time_days", d.leadDays], ...d.weekly.map((w) => ["requests_per_week", w.week, w.n] as [string, string, unknown]),
    ...d.statuses.map((x) => ["status", x.label, x.n] as [string, string, unknown]), ...d.svc.map((x) => ["service", x.label, x.n] as [string, string, unknown]), ...d.areas.map((x) => ["area", x.label, x.n] as [string, string, unknown]),
    ...d.funnel.map((x) => ["nanny_stage", x.label, x.n] as [string, string, unknown]),
    ...(can(u, "payments.manage") ? Object.entries(d.money).map(([k, v]) => ["commercial_minor_units", k, v] as [string, string, unknown]) : []),
  ];
  await audit(u.id, "report.export", "report", "insights", { from: f.from, to: f.to });
  return new Response(["section,metric,value", ...rows.map((r) => r.map(cell).join(","))].join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=omega-insights-${f.from}-${f.to}.csv`, "Cache-Control": "no-store" } });
}

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Metric definitions (documented in docs/REPORTING.md). All values come from stored records.
 * Revenue = sum of succeeded payments minus completed refunds, by payment confirmation date.
 * Booking volume = bookings created in range. Conversion = share of those reaching confirmed or later.
 */
export async function report(from: string, to: string, service?: string) {
  const svc = service ? sql`AND b.service_code = ${service}` : sql``;
  const q = async <T,>(x: ReturnType<typeof sql>) => (await db.execute(x)).rows as T[];
  const [totals] = await q<{ created: number; confirmed: number; cancelled: number; repeat: number; enquiries: number }>(sql`
    SELECT count(*)::int AS created,
      count(*) FILTER (WHERE b.status IN ('confirmed','in_progress','completed','disputed','refund_pending','refunded'))::int AS confirmed,
      count(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM bookings p WHERE p.family_id = b.family_id AND p.status = 'completed' AND p.start_date < b.start_date))::int AS repeat,
      count(*) FILTER (WHERE b.source = 'website')::int AS enquiries
    FROM bookings b WHERE b.created_at::date BETWEEN ${from} AND ${to} ${svc}`);
  const [money] = await q<{ revenue: number; refunds: number; outstanding: number; avg: number | null }>(sql`
    SELECT
      coalesce((SELECT sum(p.amount_minor) FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN bookings b ON b.id = i.booking_id WHERE p.status = 'succeeded' AND p.confirmed_at::date BETWEEN ${from} AND ${to} ${svc}),0)::int AS revenue,
      coalesce((SELECT sum(r.amount_minor) FROM refunds r JOIN payments p ON p.id = r.payment_id JOIN invoices i ON i.id = p.invoice_id JOIN bookings b ON b.id = i.booking_id WHERE r.status = 'completed' AND r.completed_at::date BETWEEN ${from} AND ${to} ${svc}),0)::int AS refunds,
      coalesce((SELECT sum(i.amount_minor - i.paid_minor) FROM invoices i JOIN bookings b ON b.id = i.booking_id WHERE i.status = 'open' AND b.status NOT IN ('cancelled','declined') ${svc}),0)::int AS outstanding,
      (SELECT avg(q.total_minor)::int FROM quotations q JOIN bookings b ON b.id = q.booking_id WHERE q.status = 'accepted' AND q.accepted_at::date BETWEEN ${from} AND ${to} ${svc}) AS avg`);
  const byStatus = await q<{ status: string; n: number }>(sql`SELECT b.status, count(*)::int AS n FROM bookings b WHERE b.created_at::date BETWEEN ${from} AND ${to} ${svc} GROUP BY 1 ORDER BY 2 DESC`);
  const byService = await q<{ service: string; n: number }>(sql`SELECT coalesce(c.name, b.service_code) AS service, count(*)::int AS n FROM bookings b LEFT JOIN service_categories c ON c.code = b.service_code WHERE b.created_at::date BETWEEN ${from} AND ${to} ${svc} GROUP BY 1 ORDER BY 2 DESC`);
  const byArea = await q<{ area: string; n: number }>(sql`SELECT coalesce(l.area, b.area_text, 'Unknown') AS area, count(*)::int AS n FROM bookings b LEFT JOIN service_locations l ON l.id = b.service_location_id WHERE b.created_at::date BETWEEN ${from} AND ${to} ${svc} GROUP BY 1 ORDER BY 2 DESC`);
  const utilisation = await q<{ nanny: string; hours: number }>(sql`
    SELECT n.display_name AS nanny, round(coalesce(sum(extract(epoch FROM (least(s.ends_at, ${to}::date + 1) - greatest(s.starts_at, ${from}::date))) / 3600) FILTER (WHERE s.id IS NOT NULL), 0))::int AS hours
    FROM nannies n LEFT JOIN booking_sessions s ON s.nanny_id = n.id AND s.blocking AND s.starts_at < ${to}::date + 1 AND s.ends_at > ${from}::date
    WHERE n.status = 'approved' GROUP BY 1 ORDER BY 2 DESC`);
  const [resp] = await q<{ hours: number | null }>(sql`
    SELECT round(avg(extract(epoch FROM (e2.created_at - e1.created_at)) / 3600)::numeric, 1)::float AS hours FROM booking_events e1
    JOIN LATERAL (SELECT created_at FROM booking_events x WHERE x.booking_id = e1.booking_id AND x.kind = 'status' AND x.from_status = 'enquiry' ORDER BY created_at LIMIT 1) e2 ON true
    JOIN bookings b ON b.id = e1.booking_id WHERE e1.to_status = 'enquiry' AND e1.created_at::date BETWEEN ${from} AND ${to} ${svc}`);
  const [docs] = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM verification_checks WHERE status = 'passed' AND expires_on <= current_date + 30`);
  return { totals, money, byStatus, byService, byArea, utilisation, responseHours: resp?.hours ?? null, expiringChecks: docs.n };
}

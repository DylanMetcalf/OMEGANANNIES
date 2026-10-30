import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";

/**
 * Management insights. Every number is a query over stored records — nothing is projected or estimated.
 * Money is kept in separate, labelled stages: quoted (sent quotations) → booked (accepted quotations) →
 * invoiced → collected (verified payments) → outstanding, with refunds shown separately.
 * Outputs are aggregates only: no family contact details or children's data.
 */
export type InsightFilters = { from: string; to: string; service?: string; area?: string; status?: string; nannyId?: string };

const q = async <T,>(x: SQL) => (await db.execute(x)).rows as T[];
function bookingWhere(f: InsightFilters, alias = "b") {
  const a = sql.raw(alias);
  // Demo and real data never share a database (the demo seed refuses to run against real users).
  const parts: SQL[] = [sql`${a}.created_at::date BETWEEN ${f.from} AND ${f.to}`];
  if (f.service) parts.push(sql`${a}.service_code = ${f.service}`);
  if (f.status) parts.push(sql`${a}.status = ${f.status}`);
  if (f.nannyId) parts.push(sql`${a}.nanny_id = ${f.nannyId}`);
  if (f.area) parts.push(sql`coalesce((SELECT l.area FROM service_locations l WHERE l.id = ${a}.service_location_id), ${a}.area_text) = ${f.area}`);
  return sql.join(parts, sql` AND `);
}
const CONFIRMED = sql`('confirmed','in_progress','completed','disputed','refund_pending','refunded')`;

export async function insights(f: InsightFilters) {
  const W = bookingWhere(f);
  const [[ov], weekly, statuses, svc, areas, [lead], [repeat], funnel, [fam], monthlyRatings, prefs, util, [money], monthlyCollected] = await Promise.all([
    q<{ families: number; nannyAccounts: number; active: number; pending: number; requests: number; confirmed: number; cancelled: number; openQuotes: number; upcoming: number; tasks: number }>(sql`SELECT
      (SELECT count(*)::int FROM families WHERE created_at::date BETWEEN ${f.from} AND ${f.to}) AS families,
      (SELECT count(*)::int FROM nannies WHERE user_id IS NOT NULL AND created_at::date BETWEEN ${f.from} AND ${f.to}) AS "nannyAccounts",
      (SELECT count(*)::int FROM nannies WHERE status = 'approved' AND published) AS active,
      (SELECT count(*)::int FROM nannies WHERE status = 'pending_approval') AS pending,
      (SELECT count(*)::int FROM bookings b WHERE ${W}) AS requests,
      (SELECT count(*)::int FROM bookings b WHERE ${W} AND b.status IN ${CONFIRMED}) AS confirmed,
      (SELECT count(*)::int FROM bookings b WHERE ${W} AND b.status = 'cancelled') AS cancelled,
      (SELECT count(*)::int FROM quotations WHERE status = 'sent' AND (valid_until IS NULL OR valid_until > now())) AS "openQuotes",
      (SELECT count(*)::int FROM bookings WHERE status = 'confirmed' AND start_date BETWEEN current_date AND current_date + 14) AS upcoming,
      (SELECT count(*)::int FROM tasks WHERE status = 'open') AS tasks`),
    q<{ week: string; n: number }>(sql`SELECT to_char(date_trunc('week', b.created_at), 'YYYY-MM-DD') AS week, count(*)::int AS n FROM bookings b WHERE ${W} GROUP BY 1 ORDER BY 1`),
    q<{ label: string; n: number }>(sql`SELECT b.status AS label, count(*)::int AS n FROM bookings b WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`),
    q<{ label: string; n: number }>(sql`SELECT coalesce(c.name, b.service_code) AS label, count(*)::int AS n FROM bookings b LEFT JOIN service_categories c ON c.code = b.service_code WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`),
    q<{ label: string; n: number }>(sql`SELECT coalesce(l.area, b.area_text, 'Not given') AS label, count(*)::int AS n FROM bookings b LEFT JOIN service_locations l ON l.id = b.service_location_id WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`),
    q<{ days: number | null }>(sql`SELECT round(avg(b.start_date - b.created_at::date)::numeric, 1)::float AS days FROM bookings b WHERE ${W}`),
    q<{ families: number; returning: number; perFamily: number | null }>(sql`SELECT count(DISTINCT family_id)::int AS families, count(DISTINCT family_id) FILTER (WHERE c > 1)::int AS returning, round(avg(c)::numeric, 2)::float AS "perFamily" FROM (SELECT b.family_id, count(*) AS c FROM bookings b WHERE ${W} AND b.family_id IS NOT NULL GROUP BY 1) x`),
    q<{ label: string; n: number }>(sql`SELECT status::text AS label, count(*)::int AS n FROM nannies WHERE status <> 'invited' GROUP BY 1`),
    q<{ families: number; shortlisted: number; views: number; referrals: number }>(sql`SELECT
      (SELECT count(*)::int FROM families WHERE created_at::date BETWEEN ${f.from} AND ${f.to}) AS families,
      (SELECT count(*)::int FROM favourites WHERE created_at::date BETWEEN ${f.from} AND ${f.to}) AS shortlisted,
      (SELECT count(*)::int FROM nanny_views WHERE viewed_at::date BETWEEN ${f.from} AND ${f.to}) AS views,
      (SELECT count(*)::int FROM referrals WHERE created_at::date BETWEEN ${f.from} AND ${f.to}) AS referrals`),
    q<{ month: string; avg: number; n: number }>(sql`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, round(avg(rating)::numeric, 2)::float AS avg, count(*)::int AS n FROM reviews WHERE status = 'published' AND created_at::date BETWEEN ${f.from} AND ${f.to} GROUP BY 1 ORDER BY 1`),
    q<{ label: string; n: number }>(sql`SELECT n.display_name AS label, count(*)::int AS n FROM bookings b CROSS JOIN LATERAL unnest(b.preferred_nanny_ids) AS p(id) JOIN nannies n ON n.id = p.id WHERE ${W} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    q<{ label: string; n: number }>(sql`SELECT n.display_name AS label, round(coalesce(sum(extract(epoch FROM (least(s.ends_at, ${f.to}::date + 1) - greatest(s.starts_at, ${f.from}::date))) / 3600) FILTER (WHERE s.id IS NOT NULL), 0))::int AS n
      FROM nannies n LEFT JOIN booking_sessions s ON s.nanny_id = n.id AND s.blocking AND s.starts_at < ${f.to}::date + 1 AND s.ends_at > ${f.from}::date WHERE n.status = 'approved' GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    q<{ quoted: number; booked: number; invoiced: number; collected: number; outstanding: number; refunds: number }>(sql`SELECT
      coalesce((SELECT sum(qq.total_minor) FROM quotations qq JOIN bookings b ON b.id = qq.booking_id WHERE qq.sent_at::date BETWEEN ${f.from} AND ${f.to} AND qq.status IN ('sent','accepted','expired','superseded')),0)::bigint::float AS quoted,
      coalesce((SELECT sum(qq.total_minor) FROM quotations qq JOIN bookings b ON b.id = qq.booking_id WHERE qq.status = 'accepted' AND qq.accepted_at::date BETWEEN ${f.from} AND ${f.to}),0)::bigint::float AS booked,
      coalesce((SELECT sum(i.amount_minor) FROM invoices i WHERE i.created_at::date BETWEEN ${f.from} AND ${f.to}),0)::bigint::float AS invoiced,
      coalesce((SELECT sum(p.amount_minor) FROM payments p WHERE p.status = 'succeeded' AND p.confirmed_at::date BETWEEN ${f.from} AND ${f.to}),0)::bigint::float AS collected,
      coalesce((SELECT sum(i.amount_minor - i.paid_minor) FROM invoices i JOIN bookings b ON b.id = i.booking_id WHERE i.status = 'open' AND b.status NOT IN ('cancelled','declined')),0)::bigint::float AS outstanding,
      coalesce((SELECT sum(r.amount_minor) FROM refunds r WHERE r.status = 'completed' AND r.completed_at::date BETWEEN ${f.from} AND ${f.to}),0)::bigint::float AS refunds`),
    q<{ month: string; n: number }>(sql`SELECT to_char(date_trunc('month', p.confirmed_at), 'YYYY-MM') AS month, sum(p.amount_minor)::bigint::float AS n FROM payments p WHERE p.status = 'succeeded' AND p.confirmed_at::date BETWEEN ${f.from} AND ${f.to} GROUP BY 1 ORDER BY 1`),
  ]);
  const conversion = ov.requests ? Math.round((ov.confirmed / ov.requests) * 100) : null;
  return { ov: { ...ov, conversion }, weekly, statuses, svc, areas, leadDays: lead?.days ?? null, repeat, funnel, fam, monthlyRatings, prefs, util, money, monthlyCollected };
}
export type Insights = Awaited<ReturnType<typeof insights>>;

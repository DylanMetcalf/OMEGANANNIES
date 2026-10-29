import "server-only";
import { and, arrayContains, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { env } from "./env";

/** Public projection: approved + published only, never internal notes, checks detail or documents. */
const PUBLIC = {
  id: s.nannies.id, slug: s.nannies.slug, displayName: s.nannies.displayName, headline: s.nannies.headline, bio: s.nannies.bio, yearsExperience: s.nannies.yearsExperience,
  services: s.nannies.services, skills: s.nannies.skills, languages: s.nannies.languages, ageGroups: s.nannies.ageGroups, areas: s.nannies.areas, canDrive: s.nannies.canDrive,
  specialistExperience: s.nannies.specialistExperience, photoUrl: s.nannies.photoUrl, isDemo: s.nannies.isDemo,
};
export type PublicNanny = { [K in keyof typeof PUBLIC]: (typeof s.nannies.$inferSelect)[K] };
const visible = () => and(eq(s.nannies.status, "approved"), eq(s.nannies.published, true), eq(s.nannies.isDemo, env.demo));

export async function searchNannies(f: { q?: string; service?: string; language?: string; area?: string; age?: string; driver?: boolean; sort?: string; ids?: string[] }) {
  const conds = [visible()];
  if (f.q) conds.push(or(ilike(s.nannies.displayName, `%${f.q}%`), ilike(s.nannies.headline, `%${f.q}%`), ilike(s.nannies.bio, `%${f.q}%`))!);
  if (f.service) conds.push(arrayContains(s.nannies.services, [f.service]));
  if (f.language) conds.push(arrayContains(s.nannies.languages, [f.language]));
  if (f.area) conds.push(arrayContains(s.nannies.areas, [f.area]));
  if (f.age) conds.push(arrayContains(s.nannies.ageGroups, [f.age]));
  if (f.driver) conds.push(eq(s.nannies.canDrive, true));
  if (f.ids?.length) conds.push(inArray(s.nannies.id, f.ids));
  const order = f.sort === "name" ? asc(s.nannies.displayName) : desc(s.nannies.yearsExperience);
  return db.select(PUBLIC).from(s.nannies).where(and(...conds)).orderBy(order).limit(60);
}
export async function publicNanny(slug: string) {
  const [n] = await db.select(PUBLIC).from(s.nannies).where(and(visible(), eq(s.nannies.slug, slug)));
  if (!n) return null;
  const quals = await db.select({ name: s.qualifications.name, issuer: s.qualifications.issuer, verified: s.qualifications.verified }).from(s.qualifications).where(and(eq(s.qualifications.nannyId, n.id), eq(s.qualifications.public, true)));
  const reviews = await db.select({ rating: s.reviews.rating, body: s.reviews.body, response: s.reviews.nannyResponse, createdAt: s.reviews.createdAt }).from(s.reviews).where(and(eq(s.reviews.nannyId, n.id), eq(s.reviews.status, "published"))).orderBy(desc(s.reviews.createdAt));
  return { n, quals, reviews };
}
/** Free days in the next `days`: no blocking session and no unavailability. A soft indicator, not a guarantee. */
export async function freeDays(nannyIds: string[], days = 14): Promise<Record<string, number>> {
  if (!nannyIds.length) return {};
  const from = new Date(), to = new Date(Date.now() + days * 86400_000);
  const busy = await db.execute<{ nanny_id: string; d: string }>(sql`
    SELECT DISTINCT nanny_id, to_char(gs AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD') AS d FROM (
      SELECT nanny_id, starts_at, ends_at FROM booking_sessions WHERE blocking AND nanny_id IN ${nannyIds} AND starts_at < ${to} AND ends_at > ${from}
      UNION ALL SELECT nanny_id, starts_at, ends_at FROM availability_exceptions WHERE kind <> 'available' AND nanny_id IN ${nannyIds} AND starts_at < ${to} AND ends_at > ${from}
    ) x, generate_series(date_trunc('day', x.starts_at), x.ends_at - interval '1 second', interval '1 day') gs`);
  const out: Record<string, number> = {};
  for (const id of nannyIds) out[id] = days - busy.rows.filter((r) => r.nanny_id === id).length;
  return out;
}
export async function ratings(nannyIds: string[]) {
  if (!nannyIds.length) return {} as Record<string, { avg: number; n: number }>;
  const r = await db.select({ id: s.reviews.nannyId, avg: sql<number>`round(avg(${s.reviews.rating})::numeric,1)::float`, n: sql<number>`count(*)::int` }).from(s.reviews).where(and(inArray(s.reviews.nannyId, nannyIds), eq(s.reviews.status, "published"))).groupBy(s.reviews.nannyId);
  return Object.fromEntries(r.map((x) => [x.id, { avg: x.avg, n: x.n }]));
}

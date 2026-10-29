import Link from "next/link";
import { asc, ilike, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Families" };
export default async function Families({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser({ perm: "families.view" });
  const q = (await searchParams).q;
  const rows = await db.select({ f: s.families, bookings: sql<number>`(SELECT count(*)::int FROM bookings b WHERE b.family_id = ${s.families.id})`, children: sql<number>`(SELECT count(*)::int FROM children c WHERE c.family_id = ${s.families.id})`, email: sql<string>`(SELECT u.email FROM family_members m JOIN users u ON u.id = m.user_id WHERE m.family_id = ${s.families.id} AND m.is_primary LIMIT 1)` })
    .from(s.families).where(q ? ilike(s.families.displayName, `%${q}%`) : undefined).orderBy(asc(s.families.displayName)).limit(200);
  return (
    <>
      <PageHeader eyebrow="Clients" title="Families" />
      <form className="mb-4 flex max-w-md gap-2" role="search"><label htmlFor="q" className="sr-only">Search</label><input id="q" name="q" defaultValue={q} placeholder="Search households" className="input" /><button className="btn-primary">Search</button></form>
      {rows.length ? <div className="card overflow-x-auto"><table className="tbl min-w-[640px]"><thead><tr><th>Household</th><th>Primary contact</th><th>Type</th><th>Children</th><th>Bookings</th></tr></thead><tbody>
        {rows.map(({ f, bookings, children, email }) => <tr key={f.id}><td><Link href={`/manage/families/${f.id}`} className="font-medium link">{f.displayName}</Link>{f.restricted && <Badge tone="bad">Restricted</Badge>}</td><td className="text-muted">{email ?? "Not yet registered"}</td><td className="capitalize">{f.audience}{f.countryOfResidence && <span className="text-muted"> · {f.countryOfResidence}</span>}</td><td>{children}</td><td>{bookings}</td></tr>)}
      </tbody></table></div> : <Empty title="No families found" />}
    </>
  );
}

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { dates, hours } from "@/components/booking/parts";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { services } from "@/lib/queries";

export const metadata = { title: "Bookings" };
const GROUPS = [
  { key: "upcoming", label: "Confirmed", match: ["confirmed", "in_progress"] },
  { key: "requests", label: "Requests & quotes", match: ["enquiry", "matching", "introduction", "quotation", "awaiting_approval", "awaiting_payment"] },
  { key: "past", label: "Past", match: ["completed", "cancelled", "declined", "refunded", "refund_pending", "disputed"] },
];
export default async function Bookings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser({ role: "family" });
  const tab = (await searchParams).tab ?? "upcoming";
  const [familyId] = await familyIdsOf(u.id);
  const all = await db.select({ b: s.bookings, nanny: s.nannies.displayName }).from(s.bookings).leftJoin(s.nannies, eq(s.nannies.id, s.bookings.nannyId)).where(eq(s.bookings.familyId, familyId)).orderBy(desc(s.bookings.startDate));
  const svc = Object.fromEntries((await services()).map((x) => [x.code, x.name]));
  const g = GROUPS.find((x) => x.key === tab) ?? GROUPS[0];
  const list = all.filter((x) => g.match.includes(x.b.status));
  return (
    <>
      <PageHeader eyebrow="Bookings" title="Your bookings" actions={<Link href="/family/bookings/new" className="btn-cta">Request a nanny</Link>} />
      <nav aria-label="Booking groups" className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-sand/50 p-1">
        {GROUPS.map((x) => <Link key={x.key} href={`?tab=${x.key}`} aria-current={x.key === g.key ? "page" : undefined} className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-center text-[14px] ${x.key === g.key ? "bg-white font-medium text-navy shadow-sm" : "text-muted"}`}>{x.label} ({all.filter((y) => x.match.includes(y.b.status)).length})</Link>)}
      </nav>
      {list.length ? (
        <div className="card divide-y divide-line">
          {list.map(({ b, nanny }) => (
            <Link key={b.id} href={`/family/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-cream/40">
              <div><p className="font-medium text-navy">{dates(b)}</p><p className="text-[13px] text-muted">{svc[b.serviceCode]} · {hours(b)} · {nanny ?? "Matching"} · <span className="font-mono">{b.reference}</span></p></div>
              <div className="flex items-center gap-3"><StatusBadge status={b.status} />{["completed", "cancelled"].includes(b.status) && <span className="text-[13px] link">Book again</span>}</div>
            </Link>
          ))}
        </div>
      ) : <Empty title={`No ${g.label.toLowerCase()} bookings`} action={<Link href="/family/bookings/new" className="btn-primary">Request a nanny</Link>} />}
    </>
  );
}

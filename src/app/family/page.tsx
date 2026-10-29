import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { NannyCard } from "@/components/family/nanny-card";
import { dates, hours } from "@/components/booking/parts";
import { Empty, PageHeader, Section, Stat, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ACTIVE } from "@/lib/booking-state";
import { familyIdsOf } from "@/lib/bookings";
import { formatMoney } from "@/lib/money";
import { freeDays, ratings, searchNannies } from "@/lib/nannies";
import { services, unreadMessages } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";
import { markNotificationsReadAction } from "./actions";

export const metadata = { title: "Home" };
export default async function FamilyHome() {
  const u = await requireUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  const [fam] = await db.select().from(s.families).where(eq(s.families.id, familyId));
  const bookings = await db.select({ b: s.bookings, nanny: s.nannies.displayName }).from(s.bookings).leftJoin(s.nannies, eq(s.nannies.id, s.bookings.nannyId)).where(and(eq(s.bookings.familyId, familyId), inArray(s.bookings.status, ACTIVE))).orderBy(s.bookings.startDate);
  const upcoming = bookings.filter((x) => ["confirmed", "in_progress"].includes(x.b.status));
  const pending = bookings.filter((x) => !["confirmed", "in_progress"].includes(x.b.status));
  const open = await db.select({ i: s.invoices, ref: s.bookings.reference, bid: s.bookings.id, st: s.bookings.status }).from(s.invoices).innerJoin(s.bookings, eq(s.bookings.id, s.invoices.bookingId)).where(and(eq(s.bookings.familyId, familyId), eq(s.invoices.status, "open")));
  const payable = open.filter((x) => x.i.kind !== "balance" || x.st !== "awaiting_payment");
  const favIds = (await db.select().from(s.favourites).where(eq(s.favourites.familyId, familyId))).map((f) => f.nannyId);
  const nannies = await searchNannies({});
  const saved = nannies.filter((n) => favIds.includes(n.id));
  const recommended = nannies.filter((n) => !favIds.includes(n.id)).slice(0, 2);
  const shown = [...saved, ...recommended];
  const [free, rate, svc, msgs] = await Promise.all([freeDays(shown.map((n) => n.id)), ratings(shown.map((n) => n.id)), services(), unreadMessages(u.id)]);
  const svcNames = Object.fromEntries(svc.map((x) => [x.code, x.name]));
  const activity = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, u.id), eq(s.notifications.channel, "in_app"))).orderBy(desc(s.notifications.createdAt)).limit(6);
  const quoteReady = bookings.filter((x) => x.b.status === "awaiting_approval");
  return (
    <>
      <PageHeader eyebrow={fam.displayName} title={`Good to see you, ${u.name.split(" ")[0]}`} description="Everything for your family's care, in one place." actions={<Link href="/family/bookings/new" className="btn-gold">Request a nanny</Link>} />
      {quoteReady.map(({ b }) => (
        <Link key={b.id} href={`/family/bookings/${b.id}`} className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-gold/40 bg-gold-50 px-5 py-4">
          <div><p className="font-medium text-navy">Your quotation for {b.reference} is ready</p><p className="text-[13px] text-muted">Accept it to hold your nanny&rsquo;s dates.</p></div><span className="btn-primary btn-sm">Review quote</span>
        </Link>
      ))}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Upcoming bookings" value={upcoming.length} href="/family/bookings" />
        <Stat label="Requests in progress" value={pending.length} href="/family/bookings" />
        <Stat label="Payments due" value={payable.length} hint={payable.length ? formatMoney(payable.reduce((a, x) => a + x.i.amountMinor - x.i.paidMinor, 0)) : "All settled"} href="/family/payments" />
        <Stat label="Unread messages" value={msgs} href="/messages" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Section title="Upcoming & in progress" action={<Link href="/family/bookings" className="text-[13px] link">All bookings</Link>}>
            {bookings.length ? (
              <ul className="-my-2 divide-y divide-line">
                {bookings.slice(0, 5).map(({ b, nanny }) => (
                  <li key={b.id}><Link href={`/family/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div><p className="font-medium text-navy">{dates(b)} <span className="font-normal text-muted">· {hours(b)}</span></p><p className="text-[13px] text-muted">{svcNames[b.serviceCode]} · {nanny ?? "Nanny being matched"} · {b.reference}</p></div>
                    <StatusBadge status={b.status} />
                  </Link></li>
                ))}
              </ul>
            ) : <Empty title="No bookings yet" action={<Link href="/family/bookings/new" className="btn-primary">Request your first booking</Link>}>Tell us your dates and we&rsquo;ll match you with a vetted nanny, usually within 4 hours.</Empty>}
          </Section>
          <div>
            <div className="mb-3 flex items-end justify-between"><h2 className="text-[26px]">{saved.length ? "Your saved nannies" : "Nannies you might love"}</h2><Link href="/family/nannies" className="text-[13px] link">Browse all</Link></div>
            <div className="grid gap-4 md:grid-cols-2">{shown.slice(0, 4).map((n) => <NannyCard key={n.id} n={n} saved={favIds.includes(n.id)} free={free[n.id]} rating={rate[n.id]} svcNames={svcNames} />)}</div>
          </div>
        </div>
        <div className="space-y-6">
          <Section title="Recent activity" action={activity.some((a) => !a.readAt) ? <form action={markNotificationsReadAction}><button className="text-[13px] link">Mark all read</button></form> : null}>
            {activity.length ? <ul className="space-y-3">{activity.map((a) => <li key={a.id} className="text-[14px]"><Link href={a.link ?? "#"} className="block"><p className={a.readAt ? "text-ink" : "font-medium text-navy"}>{!a.readAt && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-gold" />}{a.subject}</p><p className="text-[12px] text-muted">{fmtDateTime(a.createdAt)}</p></Link></li>)}</ul> : <p className="text-[14px] text-muted">Nothing new.</p>}
          </Section>
          <Section title="Need a hand?">
            <p className="text-[14px] text-muted">You&rsquo;re speaking to a founder, not a call centre. We reply within 4 hours, 7 days a week.</p>
            <div className="mt-4 flex flex-wrap gap-2"><Link href="/messages" className="btn-primary btn-sm">Message us</Link><Link href="/help" className="btn-secondary btn-sm">Help centre</Link><a href="https://wa.me/27000000000" className="btn-ghost btn-sm">WhatsApp</a></div>
          </Section>
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { dates, hours } from "@/components/booking/parts";
import { Empty, PageHeader, Section, Stat, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { unreadMessages } from "@/lib/queries";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const metadata = { title: "Overview" };
const q = async <T,>(p: Promise<T[]>) => p;
export default async function Overview() {
  const u = await requireUser({ role: "management" });
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  const B = (where: ReturnType<typeof and>) => db.select({ b: s.bookings, nanny: s.nannies.displayName, family: s.families.displayName }).from(s.bookings).leftJoin(s.nannies, eq(s.nannies.id, s.bookings.nannyId)).leftJoin(s.families, eq(s.families.id, s.bookings.familyId)).where(where).orderBy(s.bookings.startDate).limit(12);
  const [todays, upcoming, enquiries, unassigned, intros] = await Promise.all([
    B(and(inArray(s.bookings.status, ["confirmed", "in_progress"]), sql`${s.bookings.startDate} <= ${today}`, sql`${s.bookings.endDate} >= ${today}`)),
    B(and(inArray(s.bookings.status, ["confirmed", "awaiting_payment"]), sql`${s.bookings.startDate} > ${today}`, sql`${s.bookings.startDate} <= ${in14}`)),
    B(and(eq(s.bookings.status, "enquiry"))),
    B(and(inArray(s.bookings.status, ["matching", "introduction", "quotation"]), isNull(s.bookings.nannyId))),
    q(db.select({ m: s.meetings, ref: s.bookings.reference, bid: s.bookings.id }).from(s.meetings).innerJoin(s.bookings, eq(s.bookings.id, s.meetings.bookingId)).where(and(eq(s.meetings.status, "scheduled"), sql`${s.meetings.startsAt} > now() - interval '1 hour'`)).orderBy(s.meetings.startsAt).limit(8)),
  ]);
  const [changes, docs, support, exceptions, expiring] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(s.profileChangeRequests).where(eq(s.profileChangeRequests.status, "pending")),
    db.select({ c: sql<number>`count(*)::int` }).from(s.documents).where(eq(s.documents.status, "pending_review")),
    db.select({ c: sql<number>`count(*)::int` }).from(s.supportRequests).where(inArray(s.supportRequests.status, ["open", "in_progress"])),
    db.execute<{ id: string; ref: string; bid: string; kind: string; detail: string; at: Date }>(sql`
      SELECT p.id, b.reference AS ref, b.id AS bid, 'Payment ' || p.status AS kind, coalesce(p.failure_reason, '') AS detail, p.updated_at AS at FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN bookings b ON b.id = i.booking_id WHERE p.status = 'failed' AND p.updated_at > now() - interval '14 days'
      UNION ALL SELECT e.id, b.reference, b.id, 'Confirmation failed', e.note, e.created_at FROM booking_events e JOIN bookings b ON b.id = e.booking_id WHERE e.note LIKE 'Payment received but confirmation failed%' AND b.status = 'awaiting_payment'
      UNION ALL SELECT i.id, b.reference, b.id, 'Balance overdue', i.number, i.due_at FROM invoices i JOIN bookings b ON b.id = i.booking_id WHERE i.status = 'open' AND i.due_at < now() AND b.status IN ('confirmed','in_progress')
      ORDER BY 6 DESC LIMIT 10`),
    db.select({ c: s.verificationChecks, n: s.nannies.displayName, nid: s.nannies.id }).from(s.verificationChecks).innerJoin(s.nannies, eq(s.nannies.id, s.verificationChecks.nannyId)).where(and(inArray(s.verificationChecks.status, ["passed", "expired"]), sql`${s.verificationChecks.expiresOn} <= current_date + 45`, eq(s.nannies.status, "approved"))).orderBy(s.verificationChecks.expiresOn).limit(8),
  ]);
  const list = (rows: Awaited<ReturnType<typeof B>>, empty: string) => rows.length ? (
    <ul className="-my-2 divide-y divide-line">{rows.map(({ b, nanny, family }) => <li key={b.id}><Link href={`/manage/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px] hover:bg-cream/40"><span><span className="font-medium text-navy">{family ?? b.enquiryName}</span> <span className="text-muted">· {dates(b)} · {hours(b)}{nanny ? ` · ${nanny}` : ""}</span></span><StatusBadge status={b.status} /></Link></li>)}</ul>
  ) : <p className="text-[14px] text-muted">{empty}</p>;
  return (
    <>
      <PageHeader eyebrow={fmtDate(new Date())} title="Operations overview" description={`Welcome back, ${u.name.split(" ")[0]}.`} actions={<Link href="/manage/bookings?status=enquiry" className="btn-primary">Triage enquiries</Link>} />
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Today" value={todays.length} />
        <Stat label="Next 14 days" value={upcoming.length} />
        <Stat label="New enquiries" value={enquiries.length} href="/manage/bookings?status=enquiry" />
        <Stat label="Unassigned" value={unassigned.length} href="/manage/bookings?status=matching" />
        <Stat label="Approvals" value={changes[0].c + docs[0].c} hint={`${docs[0].c} docs · ${changes[0].c} profile`} href="/manage/nannies?review=1" />
        <Stat label="Payment issues" value={exceptions.rows.length} />
        <Stat label="Open support" value={support[0].c} href="/manage/support" />
        <Stat label="Unread messages" value={await unreadMessages(u.id)} href="/messages" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Today's care">{list(todays, "No care scheduled today.")}</Section>
        <Section title="New enquiries" action={<Link href="/manage/bookings?status=enquiry" className="text-[13px] link">All</Link>}>{list(enquiries, "Inbox zero. Lovely.")}</Section>
        <Section title="Unassigned requests">{list(unassigned, "Every active request has a nanny.")}</Section>
        <Section title="Coming up (14 days)">{list(upcoming, "Nothing in the next two weeks.")}</Section>
        <Section title="Introductions">{intros.length ? <ul className="space-y-2 text-[14px]">{intros.map(({ m, ref, bid }) => <li key={m.id}><Link className="link" href={`/manage/bookings/${bid}`}>{ref}</Link> · {fmtDateTime(m.startsAt)} · {m.provider.replace("_", " ")}</li>)}</ul> : <p className="text-[14px] text-muted">No introductions scheduled.</p>}</Section>
        <Section title="Payment exceptions">{exceptions.rows.length ? <ul className="space-y-2 text-[14px]">{exceptions.rows.map((e) => <li key={e.id}><Link className="link" href={`/manage/bookings/${e.bid}`}>{e.ref}</Link> · <span className="text-bad">{e.kind}</span> <span className="text-muted">{e.detail}</span></li>)}</ul> : <Empty title="No payment exceptions" />}</Section>
        <Section title="Expiring safeguarding checks">{expiring.length ? <ul className="space-y-2 text-[14px]">{expiring.map(({ c, n, nid }) => <li key={c.id}><Link className="link" href={`/manage/nannies/${nid}`}>{n}</Link> · {c.kind.replace("_", " ")} · <span className={c.expiresOn! < today ? "text-bad" : "text-warn"}>{c.expiresOn! < today ? "expired" : "expires"} {fmtDate(c.expiresOn!)}</span></li>)}</ul> : <p className="text-[14px] text-muted">All current for 45+ days.</p>}</Section>
      </div>
    </>
  );
}

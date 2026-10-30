import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowRight, CalendarCheck, CircleAlert, CreditCard, FileSignature, MessageSquare, Sparkles, UserPlus } from "lucide-react";
import { db, schema as s } from "@/db";
import { dates, hours } from "@/components/booking/parts";
import { NannyPhoto } from "@/components/family/nanny-photo";
import { Empty, PageHeader, Section, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ACTIVE } from "@/lib/booking-state";
import { progressStages } from "@/lib/booking-progress";
import { familyIdsOf } from "@/lib/bookings";
import { getDraft, recentlyViewed, shortlistOf, visibleNannies } from "@/lib/journey";
import { formatMoney } from "@/lib/money";
import { services, unreadMessages } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";
import { markNotificationsReadAction } from "./actions";

export const metadata = { title: "Home" };
type Attention = { href: string; icon: typeof CircleAlert; title: string; body: string; cta: string; tone: "gold" | "navy" };

/** Family home: what needs attention first, then upcoming care, requests, saved nannies and support. */
export default async function FamilyHome() {
  const u = await requireUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  const [[fam], bookings, open, draft, svc, msgs, kids, locs, shortlistIds, all, recent, activity] = await Promise.all([
    db.select().from(s.families).where(eq(s.families.id, familyId)),
    db.select({ b: s.bookings, nanny: s.nannies.displayName }).from(s.bookings).leftJoin(s.nannies, eq(s.nannies.id, s.bookings.nannyId)).where(and(eq(s.bookings.familyId, familyId), inArray(s.bookings.status, ACTIVE))).orderBy(s.bookings.startDate),
    db.select({ i: s.invoices, ref: s.bookings.reference, bid: s.bookings.id, st: s.bookings.status }).from(s.invoices).innerJoin(s.bookings, eq(s.bookings.id, s.invoices.bookingId)).where(and(eq(s.bookings.familyId, familyId), eq(s.invoices.status, "open"))),
    getDraft(familyId), services(), unreadMessages(u.id),
    db.select({ id: s.children.id }).from(s.children).where(eq(s.children.familyId, familyId)),
    db.select({ id: s.serviceLocations.id }).from(s.serviceLocations).where(eq(s.serviceLocations.familyId, familyId)),
    shortlistOf(familyId), visibleNannies(), recentlyViewed(familyId, 4),
    db.select().from(s.notifications).where(and(eq(s.notifications.userId, u.id), eq(s.notifications.channel, "in_app"))).orderBy(desc(s.notifications.createdAt)).limit(5),
  ]);
  const svcNames = Object.fromEntries(svc.map((x) => [x.code, x.name]));
  const upcoming = bookings.filter((x) => ["confirmed", "in_progress"].includes(x.b.status));
  const requests = bookings.filter((x) => !["confirmed", "in_progress"].includes(x.b.status));
  const payable = open.filter((x) => x.i.kind !== "balance" || x.st !== "awaiting_payment");
  const saved = shortlistIds.map((id) => all.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
  const hasDraft = !!draft.updatedAt && draft.step !== "requirements";
  const first = u.name.split(" ")[0];

  const attention: Attention[] = [
    ...bookings.filter((x) => x.b.status === "awaiting_approval").map(({ b }) => ({ href: `/family/bookings/${b.id}`, icon: FileSignature, title: `Your quotation for ${b.reference} is ready`, body: "Accept it to hold your nanny's dates.", cta: "Review quote", tone: "gold" as const })),
    ...payable.map((x) => ({ href: `/family/bookings/${x.bid}`, icon: CreditCard, title: `${x.i.kind === "deposit" ? "Deposit" : "Payment"} due for ${x.ref}`, body: `${formatMoney(x.i.amountMinor - x.i.paidMinor, x.i.currency)} outstanding.`, cta: "Pay now", tone: "gold" as const })),
    ...(hasDraft ? [{ href: "/family/book/resume", icon: Sparkles, title: "Finish your booking request", body: `You were choosing nannies${draft.req.start ? ` for ${dates({ startDate: draft.req.start, endDate: draft.req.end || draft.req.start })}` : ""}. We kept your answers.`, cta: "Continue", tone: "navy" as const }] : []),
    ...(!kids.length || !locs.length || !fam.emergencyContactPhone ? [{ href: `/family/my-family?tab=${!kids.length ? "children" : !locs.length ? "addresses" : "household"}`, icon: UserPlus, title: "Complete your family profile", body: `Add ${[!kids.length && "your children", !locs.length && "an address", !fam.emergencyContactPhone && "an emergency contact"].filter(Boolean).join(", ")} so booking is quick.`, cta: "Complete", tone: "navy" as const }] : []),
    ...(msgs ? [{ href: "/messages", icon: MessageSquare, title: `${msgs} unread message${msgs === 1 ? "" : "s"}`, body: "From Omega or your nanny.", cta: "Read", tone: "navy" as const }] : []),
  ];
  return (
    <>
      <PageHeader eyebrow={fam.displayName} title={`Good to see you, ${first}`} description={attention.length ? `${attention.length} thing${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} your attention.` : "You're all up to date."}
        actions={<Link href={hasDraft ? "/family/book/resume" : "/family/book"} className="btn-cta">{hasDraft ? "Continue booking" : "Book a nanny"}</Link>} />

      {attention.length > 0 && (
        <ul className="mb-8 grid gap-3 md:grid-cols-2">
          {attention.map((a) => (
            <li key={a.title}><Link href={a.href} className={`card card-link flex items-center gap-4 p-4 ${a.tone === "gold" ? "border-gold/40 bg-gold-50/60" : ""}`}>
              <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${a.tone === "gold" ? "bg-gold-50 text-gold-600" : "bg-navy-50 text-navy"}`}><a.icon aria-hidden className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">{a.title}</span><span className="block text-[13px] text-muted">{a.body}</span></span>
              <span className="hidden items-center gap-1 text-[13px] font-semibold text-navy sm:flex">{a.cta}<ArrowRight aria-hidden className="h-4 w-4" /></span>
            </Link></li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Section title="Upcoming care" action={<Link href="/family/bookings" className="text-[13px] link">All bookings</Link>}>
            {upcoming.length ? (
              <ul className="-my-2 divide-y divide-line">{upcoming.slice(0, 4).map(({ b, nanny }) => (
                <li key={b.id}><Link href={`/family/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3"><CalendarCheck aria-hidden className="h-5 w-5 text-ok" /><div><p className="font-medium text-ink">{dates(b)} <span className="font-normal text-muted">· {hours(b)}</span></p><p className="text-[13px] text-muted">{svcNames[b.serviceCode]} · {nanny} · {b.reference}</p></div></div>
                  <StatusBadge status={b.status} />
                </Link></li>))}</ul>
            ) : <Empty title="No upcoming care yet" action={<Link href="/family/book" className="btn-cta">Book a nanny</Link>}>Tell us your dates — we&rsquo;ll show you vetted nannies who are free.</Empty>}
          </Section>
          {requests.length > 0 && (
            <Section title="Requests in progress">
              <ul className="-my-2 divide-y divide-line">{requests.map(({ b }) => { const cur = progressStages(b)?.find((x) => x.state === "current"); return (
                <li key={b.id}><Link href={`/family/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div><p className="font-medium text-ink">{svcNames[b.serviceCode]} · {dates(b)}</p><p className="text-[13px] text-muted">{b.reference}{cur ? ` · ${cur.label}` : ""}</p></div>
                  <StatusBadge status={b.status} />
                </Link></li>); })}</ul>
            </Section>
          )}
          <section aria-labelledby="saved-h">
            <div className="mb-3 flex items-end justify-between"><h2 id="saved-h" className="text-[18px]">{saved.length ? "Your shortlist" : recent.length ? "Recently viewed" : "Meet our nannies"}</h2><Link href={saved.length ? "/family/shortlist" : "/family/book/nannies"} className="text-[13px] link">{saved.length ? "Open shortlist" : "Browse nannies"}</Link></div>
            {(saved.length ? saved : recent.length ? recent : all.slice(0, 4)).length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(saved.length ? saved : recent.length ? recent : all).slice(0, 4).map((n) => (
                <li key={n.id}><Link href={`/family/nannies/${n.slug}`} className="card card-link block overflow-hidden"><NannyPhoto name={n.displayName} src={n.photoUrl} sizes="(min-width:640px) 180px, 45vw" /><p className="truncate px-3 pt-2 text-[14px] font-semibold">{n.displayName}</p><p className="truncate px-3 pb-3 text-[12px] text-muted">{n.yearsExperience} years · {n.languages.slice(0, 2).join(", ")}</p></Link></li>))}</ul>
            ) : <p className="text-[14px] text-muted">Our nanny profiles will appear here.</p>}
          </section>
        </div>
        <div className="space-y-6">
          <Section title="Recent updates" action={activity.some((a) => !a.readAt) ? <form action={markNotificationsReadAction}><button className="text-[13px] link">Mark all read</button></form> : <Link href="/notifications" className="text-[13px] link">All</Link>}>
            {activity.length ? <ul className="space-y-3">{activity.map((a) => <li key={a.id} className="text-[14px]"><Link href={a.link ?? "/notifications"} className="block"><p className={a.readAt ? "text-ink" : "font-medium text-navy"}>{!a.readAt && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-gold" />}{a.subject}</p><p className="text-[12px] text-muted">{fmtDateTime(a.createdAt)}</p></Link></li>)}</ul> : <p className="text-[14px] text-muted">Nothing new.</p>}
          </Section>
          <Section title="Need a hand?">
            <p className="text-[14px] text-muted">You&rsquo;re speaking to a founder, not a call centre. We reply within 4 hours, 7 days a week.</p>
            <div className="mt-4 flex flex-wrap gap-2"><Link href="/messages" className="btn-primary btn-sm">Message us</Link><Link href="/help" className="btn-secondary btn-sm">Help centre</Link><Link href="/family/book/review?help=1" className="btn-ghost btn-sm">Help me choose a nanny</Link></div>
          </Section>
        </div>
      </div>
    </>
  );
}

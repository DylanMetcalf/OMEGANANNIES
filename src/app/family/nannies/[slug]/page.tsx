import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { AvailabilityPill } from "@/components/family/availability-pill";
import { NannyPhoto } from "@/components/family/nanny-photo";
import { Rating } from "@/components/family/rating";
import { ShortlistButton } from "@/components/family/shortlist-button";
import { Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { availabilityFor, getDraft, recordView } from "@/lib/journey";
import { AGE_GROUPS, reqToParams, showAverage } from "@/lib/journey-core";
import { freeDays, publicNanny } from "@/lib/nannies";
import { services } from "@/lib/queries";
import { fmtDate } from "@/lib/time";
import { reportReviewAction, selectNannyAction } from "../../journey-actions";

const CHECKS: [string, string][] = [["interview", "Personally interviewed by Omega"], ["police_clearance", "Police clearance verified"], ["reference", "References checked"], ["identity", "Identity verified"], ["first_aid", "First Aid certified"]];
export default async function Profile({ params }: { params: Promise<{ slug: string }> }) {
  const u = await requireUser({ role: "family" });
  const p = await publicNanny((await params).slug);
  if (!p) notFound();
  const { n, quals, reviews, checks } = p;
  const [familyId] = await familyIdsOf(u.id);
  const [[fav], svcList, d] = await Promise.all([db.select().from(s.favourites).where(and(eq(s.favourites.familyId, familyId), eq(s.favourites.nannyId, n.id))), services(), getDraft(familyId)]);
  await recordView(familyId, n.id);
  const svc = Object.fromEntries(svcList.map((x) => [x.code, x.name]));
  const [free, avail] = await Promise.all([freeDays([n.id], 30), availabilityFor([n.id], d.req)]);
  const rating = reviews.length ? { avg: Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10, n: reviews.length } : null;
  const first = n.displayName.split(" ")[0];
  const ages = n.ageGroups.map((a) => AGE_GROUPS.find(([k]) => k === a)?.[1] ?? a);
  const back = d.req.start ? `/family/book/nannies?${reqToParams(d.req)}` : "/family/book/nannies";
  const Item = ({ k, children }: { k: string; children: React.ReactNode }) => <div><dt className="text-[12px] font-medium text-muted">{k}</dt><dd className="mt-0.5 text-[15px]">{children}</dd></div>;
  return (
    <article className="pb-24 lg:pb-0">
      <Link href={back} className="inline-flex items-center gap-1.5 text-[13px] link"><ArrowLeft aria-hidden className="h-4 w-4" />Back to results</Link>
      <header className="mt-5 grid gap-6 md:grid-cols-[280px_1fr] md:items-end lg:grid-cols-[320px_1fr]">
        <NannyPhoto name={n.displayName} src={n.photoUrl} className="rounded-[16px]" sizes="(min-width:1024px) 320px, (min-width:768px) 280px, 92vw" eager />
        <div>
          <p className="eyebrow">Omega nanny{n.isDemo ? " · demo profile" : ""}</p>
          <h1 className="mt-2 text-[32px] leading-tight sm:text-[36px]">{n.displayName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3"><Rating r={rating} /><span className="flex items-center gap-1.5 text-[13px] font-medium text-ok"><ShieldCheck aria-hidden className="h-4 w-4" />Vetted by Omega</span>{d.req.start && <AvailabilityPill a={avail[n.id] ?? null} />}</div>
          {n.headline && <p className="mt-4 max-w-2xl font-display text-[19px] leading-snug text-ink">&ldquo;{n.headline}&rdquo;</p>}
          <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-line bg-surface/95 p-3 backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
            <form action={selectNannyAction} className="flex-1 md:flex-none"><input type="hidden" name="nannyId" value={n.id} /><button className="btn-cta w-full">Select {first}</button></form>
            <ShortlistButton nannyId={n.id} name={n.displayName} saved={!!fav} variant="button" />
          </div>
        </div>
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Section title="1 · Introduction"><p className="whitespace-pre-line text-[16px] leading-relaxed">{n.bio || "Introduction coming soon."}</p></Section>
          <Section title="2 · Experience">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item k="Years of experience">{n.yearsExperience} years</Item>
              <Item k="Services">{n.services.map((x) => svc[x] ?? x).join(", ")}</Item>
              <Item k="Ages cared for">{ages.join(", ")}</Item>
              <Item k="Driving">{n.canDrive ? "Licensed driver" : "Does not drive"}</Item>
            </dl>
          </Section>
          <Section title="6 · Relevant childcare experience">
            <p className="text-[15px] leading-relaxed">{first} has cared for {ages.map((a) => a.toLowerCase()).join(", ")}{n.services.length ? ` across ${n.services.map((x) => (svc[x] ?? x).toLowerCase()).join(", ")} placements` : ""}.</p>
            {n.specialistExperience && <p className="mt-3 rounded-[10px] bg-cream p-3 text-[14px]"><strong className="text-navy">Specialist experience:</strong> {n.specialistExperience}</p>}
          </Section>
          <Section title={`8 · Reviews${rating ? ` (${rating.n})` : ""}`}>
            {showAverage(rating) && <p className="mb-4 flex items-baseline gap-2"><span className="font-display text-[32px] font-bold text-ink">{rating!.avg.toFixed(1)}</span><span className="text-[14px] text-muted">average from {rating!.n} verified reviews</span></p>}
            {reviews.length ? (
              <ul className="divide-y divide-line">{reviews.map((r) => (
                <li key={r.id} className="py-4 first:pt-0">
                  <p className="text-gold" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}<span className="text-sand">{"★".repeat(5 - r.rating)}</span></p>
                  <p className="mt-1 text-[15px] leading-relaxed">&ldquo;{r.body}&rdquo;</p>
                  {r.response && <p className="mt-2 rounded-[8px] bg-cream px-3 py-2 text-[13px] text-muted"><strong className="text-ink">{first}:</strong> {r.response}</p>}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
                    <span>Verified family · completed Omega booking · {fmtDate(r.createdAt)}</span>
                    <details><summary className="cursor-pointer link">Report</summary>
                      <ActionForm action={reportReviewAction} className="mt-2 flex gap-2"><input type="hidden" name="reviewId" value={r.id} /><label className="sr-only" htmlFor={`rr-${r.id}`}>Reason</label><input id={`rr-${r.id}`} name="reason" required minLength={5} maxLength={500} placeholder="What's wrong?" className="input !min-h-9 !py-1.5" /><Submit className="btn-secondary btn-sm" pendingText="…">Send</Submit></ActionForm>
                    </details>
                  </div>
                </li>))}</ul>
            ) : <p className="text-[14px] text-muted">No reviews yet. Only families who completed a booking with {first} can leave one, and every review is moderated.</p>}
          </Section>
        </div>
        <aside className="space-y-6">
          <Section title="3 · Qualifications">
            <ul className="space-y-2 text-[14px]">
              {CHECKS.filter(([k]) => checks.includes(k)).map(([k, x]) => <li key={k} className="flex gap-2"><ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />{x}</li>)}
              {quals.map((q) => <li key={q.name} className="flex gap-2"><ShieldCheck aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${q.verified ? "text-ok" : "text-subtle"}`} />{q.name}{q.issuer ? ` · ${q.issuer}` : ""}{q.verified ? "" : " (being verified)"}</li>)}
            </ul>
            <p className="mt-3 text-[12px] text-muted">Shown from Omega&rsquo;s current check records. Documents are held privately and never shared.</p>
          </Section>
          <Section title="4 · Skills"><p className="text-[15px]">{n.skills.length ? n.skills.join(" · ") : "—"}</p></Section>
          <Section title="5 · Languages"><p className="text-[15px]">{n.languages.join(", ")}</p></Section>
          <Section title="7 · Availability">
            {d.req.start && <div className="mb-3"><AvailabilityPill a={avail[n.id] ?? null} /></div>}
            <p className="text-[15px]">{free[n.id]} of the next 30 days open</p>
            <p className="mt-1 text-[12px] text-muted">Indicative, from confirmed bookings, time off and synced calendars. Omega confirms availability before quoting.</p>
          </Section>
          <Section title="9 · Also good to know"><dl className="space-y-3"><Item k="Areas covered">{n.areas.join(", ")}</Item></dl></Section>
        </aside>
      </div>
    </article>
  );
}

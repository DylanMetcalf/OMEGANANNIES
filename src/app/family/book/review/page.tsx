import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { dates as fmtDates } from "@/components/booking/parts";
import { JourneySteps } from "@/components/family/journey-steps";
import { PreferencesForm } from "@/components/family/preferences-form";
import { PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { availabilityFor, estimateFor, getDraft, shortlistOf, visibleNannies } from "@/lib/journey";
import { AGE_GROUPS, reqToParams, WEEKDAYS } from "@/lib/journey-core";
import { formatMoney } from "@/lib/money";
import { services } from "@/lib/queries";
import { careDates } from "@/lib/time";

export const metadata = { title: "Review & send" };
export default async function Review({ searchParams }: { searchParams: Promise<{ help?: string }> }) {
  const u = await requireUser({ role: "family" });
  const sp = await searchParams;
  const [familyId] = await familyIdsOf(u.id);
  const d = await getDraft(familyId);
  const r = d.req;
  const [ids, all, kids, locs, svc] = await Promise.all([shortlistOf(familyId), visibleNannies(), db.select().from(s.children).where(eq(s.children.familyId, familyId)), db.select().from(s.serviceLocations).where(eq(s.serviceLocations.familyId, familyId)), services()]);
  const list = ids.map((id) => all.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
  const [avail, est] = await Promise.all([availabilityFor(list.map((n) => n.id), r), estimateFor(r, familyId)]);
  const svcName = svc.find((x) => x.code === r.service)?.name;
  const chosenKids = kids.filter((k) => (r.kids.length ? r.kids.includes(k.id) : true));
  if (!r.service || !r.start) return (
    <div className="mx-auto max-w-3xl"><JourneySteps current={2} /><PageHeader title="Let's start with your needs" description="We need your dates and area before you can send a request." actions={<Link href="/family/book" className="btn-cta">Tell us what you need</Link>} /></div>
  );
  const days = careDates({ startDate: r.start, endDate: r.end || r.start, weekdays: r.recurring && r.weekdays.length < 7 ? r.weekdays : null, liveIn: r.service === "live_in" }).length;
  const rows: [string, React.ReactNode, string][] = [
    ["Service", svcName, "/family/book"],
    ["When", <>{fmtDates({ startDate: r.start, endDate: r.end || r.start })}{r.recurring && r.weekdays.length ? ` · ${r.weekdays.map((w) => WEEKDAYS[(w + 6) % 7]).join(", ")}` : ""}<span className="block text-[12px] text-muted">{days} care day{days === 1 ? "" : "s"}</span></>, "/family/book"],
    ["Hours", r.service === "live_in" ? "Live-in, around the clock" : `${r.t1} – ${r.t2}`, "/family/book"],
    ["Area", r.area, "/family/book"],
    ["Children", chosenKids.length ? chosenKids.map((k) => k.preferredName).join(", ") : r.ages.map((a) => AGE_GROUPS.find(([k]) => k === a)?.[1]).join(", "), "/family/book"],
    ...(r.langs.length || r.driver || r.specialist || r.minExp ? [["Preferences", [r.langs.length ? `Speaks ${r.langs.join(", ")}` : "", r.driver ? "Drives" : "", r.specialist ? "Additional-needs experience" : "", r.minExp ? `${r.minExp}+ years` : ""].filter(Boolean).join(" · "), "/family/book"] as [string, string, string]] : []),
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <JourneySteps current={2} query={`?${reqToParams(r)}`} />
      <PageHeader eyebrow="Review & send" title="Almost there" description="Check the details, choose your preferred nannies, and send. Our team replies within 4 hours." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <PreferencesForm shortlist={list.map((n) => ({ id: n.id, name: n.displayName, photo: n.photoUrl, slug: n.slug, years: n.yearsExperience, availability: avail[n.id] ?? null }))} initialPrefs={d.prefs} initialHelp={sp.help === "1" || d.assistance}
          locations={locs.map((l) => ({ id: l.id, label: `${l.label} · ${l.area}` }))} hasKids={kids.length > 0} />
        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <Section title="Your request">
            <dl className="space-y-3 text-[14px]">{rows.map(([k, v, h]) => <div key={k} className="flex items-start justify-between gap-3"><div><dt className="text-[12px] text-muted">{k}</dt><dd className="mt-0.5">{v}</dd></div><Link href={h} className="text-[12px] link" aria-label={`Edit ${k}`}>Edit</Link></div>)}</dl>
          </Section>
          <Section title="Estimated price">
            {est && !("error" in est) ? (
              <>
                <p className="font-display text-[26px] font-bold tabular-nums text-ink">{formatMoney(est.total, est.currency)}</p>
                <p className="text-[13px] text-muted">Deposit to confirm, once quoted: {formatMoney(est.deposit, est.currency)}</p>
                <p className="mt-3 text-[12px] text-muted">An estimate from Omega&rsquo;s current rates. Your quotation confirms the final price — public holidays, travel and overnight fees are added there if they apply.</p>
              </>
            ) : <p className="text-[14px] text-muted">{est?.error ?? "Your quotation will confirm the price."}</p>}
          </Section>
          <Section title="What happens next">
            <ol className="space-y-2 text-[14px]">{["We check your preferred nannies are free.", "Your nanny confirms the booking offer.", "You receive a quotation to accept.", "Pay the deposit — your booking is confirmed."].map((t, i) => <li key={t} className="flex gap-2.5"><span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sand text-[11px] font-bold text-navy">{i + 1}</span>{t}</li>)}</ol>
          </Section>
        </aside>
      </div>
    </div>
  );
}

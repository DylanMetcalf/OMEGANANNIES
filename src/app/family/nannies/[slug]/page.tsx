import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { Avatar, Badge, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { freeDays, publicNanny } from "@/lib/nannies";
import { services } from "@/lib/queries";
import { toggleFavouriteAction } from "../../actions";

export default async function Profile({ params }: { params: Promise<{ slug: string }> }) {
  const u = await requireUser({ role: "family" });
  const p = await publicNanny((await params).slug);
  if (!p) notFound();
  const { n, quals, reviews } = p;
  const [familyId] = await familyIdsOf(u.id);
  const [fav] = await db.select().from(s.favourites).where(and(eq(s.favourites.familyId, familyId), eq(s.favourites.nannyId, n.id)));
  const svc = Object.fromEntries((await services()).map((x) => [x.code, x.name]));
  const free = (await freeDays([n.id], 30))[n.id];
  const avg = reviews.length ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1) : null;
  const AGE: Record<string, string> = { newborn: "Newborns", toddler: "Toddlers", preschool: "Pre-schoolers", school: "School age", teen: "Teens" };
  return (
    <article>
      <Link href="/family/nannies" className="text-[13px] link">← All nannies</Link>
      <header className="mt-6 grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center">
        <Avatar name={n.displayName} src={n.photoUrl} size={168} />
        <div>
          <p className="eyebrow">Omega nanny{n.isDemo ? " · demo profile" : ""}</p>
          <h1 className="mt-2 text-[52px] leading-none">{n.displayName}</h1>
          <p className="mt-4 max-w-2xl font-display text-[24px] italic leading-snug text-navy/90">&ldquo;{n.headline}&rdquo;</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={`/family/bookings/new?nanny=${n.id}`} className="btn-gold">Request {n.displayName.split(" ")[0]}</Link>
            <form action={toggleFavouriteAction}><input type="hidden" name="nannyId" value={n.id} /><button className="btn-secondary" aria-pressed={!!fav}>{fav ? "♥ Saved" : "♡ Save"}</button></form>
          </div>
        </div>
      </header>
      <div className="mt-10 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Section title={`About ${n.displayName.split(" ")[0]}`}><p className="whitespace-pre-line text-[16px] leading-relaxed">{n.bio}</p>{n.specialistExperience && <p className="mt-4 rounded-lg bg-cream p-3 text-[14px]"><strong className="text-navy">Specialist experience:</strong> {n.specialistExperience}</p>}</Section>
          <Section title={`Family reviews${avg ? ` · ★ ${avg}` : ""}`}>
            {reviews.length ? <ul className="space-y-5">{reviews.map((r, i) => <li key={i}><p className="text-gold" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}<span className="text-sand">{"★".repeat(5 - r.rating)}</span></p><p className="mt-1 font-display text-[19px] leading-snug">&ldquo;{r.body}&rdquo;</p>{r.response && <p className="mt-2 border-l-2 border-gold pl-3 text-[13px] text-muted">{n.displayName.split(" ")[0]}: {r.response}</p>}</li>)}</ul> : <p className="text-[14px] text-muted">No published reviews yet.</p>}
          </Section>
        </div>
        <aside className="space-y-6">
          <Section title="At a glance">
            <dl className="space-y-3 text-[14px]">
              <div><dt className="text-muted">Experience</dt><dd>{n.yearsExperience} years</dd></div>
              <div><dt className="text-muted">Services</dt><dd className="mt-1 flex flex-wrap gap-1.5">{n.services.map((x) => <Badge key={x}>{svc[x] ?? x}</Badge>)}</dd></div>
              <div><dt className="text-muted">Languages</dt><dd>{n.languages.join(", ")}</dd></div>
              <div><dt className="text-muted">Ages</dt><dd>{n.ageGroups.map((a) => AGE[a] ?? a).join(", ")}</dd></div>
              <div><dt className="text-muted">Areas</dt><dd>{n.areas.join(", ")}</dd></div>
              <div><dt className="text-muted">Driving</dt><dd>{n.canDrive ? "Licensed driver" : "Does not drive"}</dd></div>
              {!!n.skills.length && <div><dt className="text-muted">Skills</dt><dd>{n.skills.join(" · ")}</dd></div>}
              <div><dt className="text-muted">Availability</dt><dd>{free} of the next 30 days open <span className="block text-[12px] text-muted">Indicative — confirmed when we quote.</span></dd></div>
            </dl>
          </Section>
          <Section title="Vetting & qualifications">
            <ul className="space-y-2 text-[14px]">
              {["Personally interviewed", "Police clearance verified", "References checked", "Identity verified"].map((x) => <li key={x} className="flex gap-2"><span className="text-ok">✓</span>{x}</li>)}
              {quals.map((q) => <li key={q.name} className="flex gap-2"><span className="text-ok">✓</span>{q.name}{q.verified ? "" : " (pending verification)"}</li>)}
            </ul>
            <p className="mt-3 text-[12px] text-muted">Vetting documents are held privately by Omega and never shared.</p>
          </Section>
        </aside>
      </div>
    </article>
  );
}

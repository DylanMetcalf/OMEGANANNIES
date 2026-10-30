import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AvailabilityPill } from "./availability-pill";
import { NannyPhoto } from "./nanny-photo";
import { Rating } from "./rating";
import { ShortlistButton } from "./shortlist-button";
import { selectNannyAction } from "@/app/family/journey-actions";
import { AGE_GROUPS, type Availability } from "@/lib/journey-core";
import type { publicNanny } from "@/lib/nannies";

type P = NonNullable<Awaited<ReturnType<typeof publicNanny>>>;
/** Preview content for the drawer: the essentials to decide whether to look closer or shortlist. */
export function ProfilePreview({ p, saved, availability, svc, closeHref }: { p: P; saved: boolean; availability: Availability; svc: Record<string, string>; closeHref: string }) {
  const { n, quals, reviews, checks } = p;
  const rating = reviews.length ? { avg: Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10, n: reviews.length } : null;
  const first = n.displayName.split(" ")[0];
  return (
    <div>
      <NannyPhoto name={n.displayName} src={n.photoUrl} ratio="aspect-[4/3]" sizes="480px" eager />
      <div className="space-y-5 px-5 pt-5">
        <div>
          <div className="flex items-start justify-between gap-3"><h2 className="text-[24px] leading-tight">{n.displayName}</h2><Rating r={rating} /></div>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-ok"><ShieldCheck aria-hidden className="h-4 w-4" />{checks.length >= 5 ? "Interviewed, police-clearance, ID, reference and First Aid checked" : "Vetted by Omega"}</p>
          <div className="mt-3"><AvailabilityPill a={availability} /></div>
        </div>
        {n.headline && <p className="font-display text-[17px] leading-snug text-ink">&ldquo;{n.headline}&rdquo;</p>}
        {n.bio && <p className="line-clamp-5 text-[14px] leading-relaxed text-muted">{n.bio}</p>}
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <div><dt className="text-muted">Experience</dt><dd className="font-medium">{n.yearsExperience} years</dd></div>
          <div><dt className="text-muted">Languages</dt><dd className="font-medium">{n.languages.join(", ")}</dd></div>
          <div><dt className="text-muted">Ages</dt><dd className="font-medium">{n.ageGroups.map((a) => AGE_GROUPS.find(([k]) => k === a)?.[1] ?? a).join(", ")}</dd></div>
          <div><dt className="text-muted">Areas</dt><dd className="font-medium">{n.areas.join(", ")}</dd></div>
          <div className="col-span-2"><dt className="text-muted">Services</dt><dd className="font-medium">{n.services.map((s) => svc[s] ?? s).join(", ")}</dd></div>
          {!!n.skills.length && <div className="col-span-2"><dt className="text-muted">Skills</dt><dd className="font-medium">{n.skills.join(" · ")}</dd></div>}
          {!!quals.length && <div className="col-span-2"><dt className="text-muted">Qualifications</dt><dd className="font-medium">{quals.map((q) => q.name + (q.verified ? "" : " (being verified)")).join(" · ")}</dd></div>}
        </dl>
        {reviews[0] && <figure className="rounded-[12px] bg-cream p-4"><blockquote className="text-[14px] leading-relaxed">&ldquo;{reviews[0].body}&rdquo;</blockquote><figcaption className="mt-2 text-[12px] text-muted">Verified family review · completed booking</figcaption></figure>}
        <div className="grid gap-2 pt-1">
          <form action={selectNannyAction}><input type="hidden" name="nannyId" value={n.id} /><button className="btn-cta w-full">Select {first}</button></form>
          <div className="grid grid-cols-2 gap-2"><ShortlistButton nannyId={n.id} name={n.displayName} saved={saved} variant="button" /><Link href={`/family/nannies/${n.slug}`} className="btn-secondary">Full profile</Link></div>
          <Link href={closeHref} scroll={false} replace className="btn-ghost">Continue browsing</Link>
        </div>
        <p className="pb-2 text-[12px] text-muted">Selecting a nanny sends your preference with your request — it isn&rsquo;t a confirmed booking.</p>
      </div>
    </div>
  );
}

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { LinkPending } from "@/components/link-pending";
import { AvailabilityPill } from "./availability-pill";
import { NannyPhoto } from "./nanny-photo";
import { Rating } from "./rating";
import { ShortlistButton } from "./shortlist-button";
import type { Availability } from "@/lib/journey-core";
import type { CardNanny } from "@/lib/journey";

type N = CardNanny & { availability: Availability; rating: { avg: number; n: number } | null; reasons: string[] };
/** Discovery card: photo-led, scannable, with the two actions families need — preview and shortlist. */
export function DiscoverCard({ n, saved, previewHref, svc }: { n: N; saved: boolean; previewHref: string; svc: Record<string, string> }) {
  return (
    <article className="card card-link group relative flex flex-col overflow-hidden">
      <div className="relative">
        <Link href={previewHref} scroll={false} tabIndex={-1} aria-hidden className="relative block"><LinkPending /><NannyPhoto name={n.displayName} src={n.photoUrl} ratio="aspect-[4/3]" className="transition-transform duration-500 group-hover:scale-[1.02]" /></Link>
        <div className="absolute right-3 top-3"><ShortlistButton nannyId={n.id} name={n.displayName} saved={saved} /></div>
        <div className="absolute bottom-3 left-3"><AvailabilityPill a={n.availability} /></div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[18px] leading-tight"><Link href={previewHref} scroll={false} aria-label={`Preview ${n.displayName}`} className="hover:underline">{n.displayName}</Link></h3>
          <Rating r={n.rating} compact />
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium text-ok"><ShieldCheck aria-hidden className="h-3.5 w-3.5" />Vetted by Omega{n.isDemo ? <span className="text-muted"> · demo profile</span> : null}</p>
        {n.headline && <p className="mt-2 line-clamp-2 text-[14px] leading-snug text-muted">{n.headline}</p>}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-muted">Experience</dt><dd>{n.yearsExperience} years</dd>
          <dt className="text-muted">Languages</dt><dd className="truncate">{n.languages.join(", ")}</dd>
          <dt className="text-muted">Areas</dt><dd className="truncate">{n.areas.join(", ")}</dd>
        </dl>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {n.services.slice(0, 2).map((x) => <span key={x} className="rounded-full bg-sand px-2 py-0.5 text-[12px] text-ink">{svc[x] ?? x}</span>)}
          {n.skills.slice(0, 2).map((x) => <span key={x} className="rounded-full bg-sand px-2 py-0.5 text-[12px] text-ink">{x}</span>)}
        </div>
        {!!n.reasons.length && <p className="mt-3 text-[12px] text-navy">✓ {n.reasons.slice(0, 2).join(" · ")}</p>}
        <div className="mt-auto pt-4"><Link href={previewHref} scroll={false} className="btn-secondary btn-sm relative w-full overflow-hidden"><LinkPending />View profile</Link></div>
      </div>
    </article>
  );
}

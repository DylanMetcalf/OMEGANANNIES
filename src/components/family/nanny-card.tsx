import Link from "next/link";
import { Avatar, Badge } from "@/components/ui";
import type { PublicNanny } from "@/lib/nannies";
import { toggleFavouriteAction } from "@/app/family/actions";

export function NannyCard({ n, saved, free, rating, svcNames, compare }: { n: PublicNanny; saved: boolean; free?: number; rating?: { avg: number; n: number }; svcNames: Record<string, string>; compare?: boolean }) {
  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="flex gap-4 p-5">
        <Avatar name={n.displayName} src={n.photoUrl} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[24px] leading-tight"><Link href={`/family/nannies/${n.slug}`} className="hover:underline">{n.displayName}</Link></h3>
            <form action={toggleFavouriteAction}><input type="hidden" name="nannyId" value={n.id} /><button aria-pressed={saved} aria-label={saved ? `Remove ${n.displayName} from saved` : `Save ${n.displayName}`} className={`rounded-full p-1.5 text-[18px] leading-none ${saved ? "text-gold" : "text-muted hover:text-gold"}`}>{saved ? "♥" : "♡"}</button></form>
          </div>
          <p className="text-[13px] text-muted">{n.yearsExperience} years · {n.languages.join(", ")}{rating ? ` · ★ ${rating.avg} (${rating.n})` : ""}</p>
        </div>
      </div>
      <p className="px-5 text-[15px] leading-snug text-muted">&ldquo;{n.headline}&rdquo;</p>
      <div className="flex flex-wrap gap-1.5 px-5 pt-4">
        {n.services.slice(0, 3).map((x) => <Badge key={x}>{svcNames[x] ?? x}</Badge>)}
        {n.canDrive && <Badge tone="info">Drives</Badge>}
        {n.isDemo && <Badge tone="gold">Demo profile</Badge>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line px-5 py-3 mt-5">
        <span className="text-[12px] text-muted">{free === undefined ? "" : free >= 10 ? "Good availability next 2 weeks" : free > 0 ? `${free} open days next 2 weeks` : "Fully booked next 2 weeks"}</span>
        <div className="flex items-center gap-3">
          {compare && <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" name="ids" value={n.id} form="compare" className="accent-navy" />Compare</label>}
          <Link href={`/family/nannies/${n.slug}`} className="btn-secondary btn-sm">View profile</Link>
        </div>
      </div>
    </article>
  );
}

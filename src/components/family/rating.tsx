import { Star } from "lucide-react";
import { showAverage } from "@/lib/journey-core";
/** Only published reviews from completed bookings count. An average needs at least three. */
export function Rating({ r, compact }: { r: { avg: number; n: number } | null; compact?: boolean }) {
  if (!r) return compact ? null : <span className="text-[12px] text-muted">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-ink">
      <Star aria-hidden className="h-3.5 w-3.5 fill-gold text-gold" />
      {showAverage(r) ? <><strong className="font-semibold">{r.avg.toFixed(1)}</strong><span className="text-muted">({r.n})</span></> : <span className="text-muted">{r.n} review{r.n === 1 ? "" : "s"}</span>}
      <span className="sr-only">{showAverage(r) ? `Average ${r.avg} out of 5 from ${r.n} verified reviews` : `${r.n} verified reviews`}</span>
    </span>
  );
}

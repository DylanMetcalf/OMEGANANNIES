import Link from "next/link";
import { Check } from "lucide-react";

const STEPS = [["Your needs", "/family/book"], ["Choose nannies", "/family/book/nannies"], ["Review & send", "/family/book/review"]] as const;
/** Booking journey progress. Earlier steps stay clickable so families can go back and edit without losing anything. */
export function JourneySteps({ current, query = "" }: { current: 0 | 1 | 2; query?: string }) {
  return (
    <nav aria-label="Booking steps" className="mb-6">
      <ol className="flex items-center gap-2 sm:gap-3">
        {STEPS.map(([label, href], i) => {
          const done = i < current, on = i === current;
          const body = (
            <span className={`flex items-center gap-2 rounded-full px-1 py-1 pr-3 text-[13px] font-medium transition-colors ${on ? "text-ink" : done ? "text-navy hover:bg-navy-50" : "text-muted"}`}>
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${done ? "bg-ok text-white" : on ? "bg-navy text-white" : "bg-sand text-muted"}`}>{done ? <Check aria-hidden className="h-4 w-4" /> : i + 1}</span>
              <span className={on ? "" : "sr-only sm:not-sr-only"}>{label}</span>
            </span>
          );
          return (
            <li key={href} className="flex items-center gap-2 sm:gap-3" aria-current={on ? "step" : undefined}>
              {done ? <Link href={`${href}${i === 1 ? query : ""}`}>{body}</Link> : body}
              {i < STEPS.length - 1 && <span aria-hidden className={`h-px w-6 sm:w-10 ${done ? "bg-ok" : "bg-line"}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

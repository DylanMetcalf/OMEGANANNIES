import type { Availability } from "@/lib/journey-core";
const MAP = { available: ["Free on your dates", "bg-ok-50 text-ok", "bg-ok"], partial: ["Free on some dates", "bg-warn-50 text-warn", "bg-warn"], unavailable: ["Not free on your dates", "bg-sand text-muted", "bg-subtle"] } as const;
/** Availability comes from real holds, time off and calendar busy periods — indicative until Omega confirms. */
export function AvailabilityPill({ a }: { a: Availability }) {
  if (!a) return <span className="text-[12px] text-muted">Add dates to see availability</span>;
  const [t, c, d] = MAP[a];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${c}`}><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${d}`} />{t}</span>;
}

import Link from "next/link";
import { dates, hours } from "@/components/booking/parts";
import { Badge, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { nannyOf } from "@/lib/bookings";
import { nannyBookings } from "@/lib/nanny-data";
import { services } from "@/lib/queries";

export const metadata = { title: "My bookings" };
export default async function NannyBookings() {
  const u = await requireUser({ role: "nanny" });
  const n = await nannyOf(u.id);
  if (!n) return <Empty title="Profile not linked" />;
  const rows = await nannyBookings(n.id, ["matching", "introduction", "quotation", "awaiting_approval", "awaiting_payment", "confirmed", "in_progress", "completed"]);
  const svc = Object.fromEntries((await services()).map((x) => [x.code, x.name]));
  return (
    <>
      <PageHeader eyebrow="Bookings" title="My bookings" description="Only bookings you've been assigned to appear here. Full care instructions unlock once a booking is confirmed." />
      {rows.length ? <div className="card divide-y divide-line">{rows.map(({ b, area }) => (
        <Link key={b.id} href={`/nanny/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-cream/40">
          <div><p className="font-medium text-navy">{dates(b)} · {hours(b)}</p><p className="text-[13px] text-muted">{svc[b.serviceCode]} · {area ?? b.areaText} · <span className="font-mono">{b.reference}</span></p></div>{b.nannyResponse === "pending" ? <Badge tone="gold">Offer — please respond</Badge> : <StatusBadge status={b.status} />}
        </Link>
      ))}</div> : <Empty title="No bookings yet" />}
    </>
  );
}

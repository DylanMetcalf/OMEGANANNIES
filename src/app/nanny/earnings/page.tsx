import { dates } from "@/components/booking/parts";
import { Empty, Notice, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { nannyOf } from "@/lib/bookings";
import { nannyBookings } from "@/lib/nanny-data";
import { careDates, windowMinutes } from "@/lib/time";

export const metadata = { title: "Engagements" };
export default async function Earnings() {
  const u = await requireUser({ role: "nanny" });
  const n = await nannyOf(u.id);
  if (!n) return <Empty title="Profile not linked" />;
  const done = await nannyBookings(n.id, ["completed"]);
  const hrs = (b: (typeof done)[number]["b"]) => (b.liveIn ? careDates(b).length * 24 : (careDates(b).length * windowMinutes(b.dailyStartMinute, b.dailyEndMinute)) / 60);
  return (
    <>
      <PageHeader eyebrow="Engagements" title="Completed engagements" />
      <div className="mb-6"><Notice tone="info" title="Compensation records">Agreed pay rates, expenses and payouts will appear here once Omega confirms its nanny compensation model. Family payment details are never shown to nannies.</Notice></div>
      <Section title={`${done.length} completed · ${done.reduce((a, x) => a + hrs(x.b), 0).toFixed(0)} hours`}>
        {done.length ? <table className="tbl"><thead><tr><th>Booking</th><th>Dates</th><th className="text-right">Hours</th></tr></thead><tbody>{done.map(({ b }) => <tr key={b.id}><td className="font-mono text-[13px]">{b.reference}</td><td>{dates(b)}</td><td className="text-right">{hrs(b).toFixed(1)}</td></tr>)}</tbody></table> : <Empty title="No completed engagements yet" />}
      </Section>
    </>
  );
}

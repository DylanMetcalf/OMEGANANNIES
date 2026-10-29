import Link from "next/link";
import { Avatar, Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { freeDays, ratings, searchNannies } from "@/lib/nannies";
import { services } from "@/lib/queries";

export const metadata = { title: "Compare nannies" };
export default async function Compare({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  await requireUser({ role: "family" });
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 4);
  const list = ids.length ? await searchNannies({ ids }) : [];
  if (list.length < 2) return <><PageHeader title="Compare nannies" /><Empty title="Choose at least two nannies" action={<Link className="btn-primary" href="/family/nannies">Back to nannies</Link>}>Tick &ldquo;Compare&rdquo; on two to four profiles.</Empty></>;
  const [free, rate, svc] = await Promise.all([freeDays(ids), ratings(ids), services()]);
  const sv = Object.fromEntries(svc.map((x) => [x.code, x.name]));
  const rows: [string, (n: (typeof list)[number]) => React.ReactNode][] = [
    ["Experience", (n) => `${n.yearsExperience} years`], ["Services", (n) => n.services.map((x) => sv[x]).join(", ")], ["Languages", (n) => n.languages.join(", ")],
    ["Age groups", (n) => n.ageGroups.join(", ")], ["Areas", (n) => n.areas.join(", ")], ["Drives", (n) => (n.canDrive ? "Yes" : "No")],
    ["Specialist", (n) => n.specialistExperience ?? "—"], ["Reviews", (n) => (rate[n.id] ? `★ ${rate[n.id].avg} (${rate[n.id].n})` : "—")], ["Open days (14d)", (n) => free[n.id]],
  ];
  return (
    <>
      <PageHeader eyebrow="Compare" title="Side by side" actions={<Link className="btn-secondary" href="/family/nannies">Back</Link>} />
      <div className="card overflow-x-auto">
        <table className="tbl min-w-[640px]">
          <thead><tr><th className="w-40" />{list.map((n) => <th key={n.id} className="!normal-case"><div className="flex items-center gap-3 py-2"><Avatar name={n.displayName} size={40} /><span className="font-display text-[20px] tracking-normal text-navy">{n.displayName}</span></div></th>)}</tr></thead>
          <tbody>
            {rows.map(([k, f]) => <tr key={k}><td className="font-medium text-muted">{k}</td>{list.map((n) => <td key={n.id}>{f(n)}</td>)}</tr>)}
            <tr><td />{list.map((n) => <td key={n.id}><Link href={`/family/bookings/new?nanny=${n.id}`} className="btn-primary btn-sm">Request</Link></td>)}</tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Minimal, dependency-free charts for management insights. Single series → one hue (info blue, validated against the
 * surface), no legend (the title names the series); thin bars with rounded data-ends; values on hover/focus and in an
 * accessible table so nothing depends on colour or pointer alone.
 */
type Row = { label: string; n: number };

export function BarList({ title, rows, format = (n: number) => String(n), empty = "No data in this range." }: { title: string; rows: Row[]; format?: (n: number) => string; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <figure>
      <figcaption className="mb-3 text-[13px] font-semibold text-ink">{title}</figcaption>
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13px]">
              <span className="truncate text-muted" title={r.label}>{r.label.replace(/_/g, " ")}</span>
              <span className="h-2.5 rounded-full bg-sand" aria-hidden><span className="block h-full rounded-full bg-info" style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }} /></span>
              <span className="w-16 text-right font-medium tabular-nums text-ink">{format(r.n)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">{empty}</p>}
    </figure>
  );
}

/** Column chart over time with per-column hover/focus values; a table follows for screen readers and exact reading. */
export function Columns({ title, rows, format = (n: number) => String(n) }: { title: string; rows: Row[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <figure><figcaption className="mb-3 text-[13px] font-semibold text-ink">{title}</figcaption><p className="text-[13px] text-muted">No data in this range.</p></figure>;
  return (
    <figure>
      <figcaption className="mb-3 flex items-baseline justify-between text-[13px] font-semibold text-ink"><span>{title}</span><span className="font-normal text-muted">peak {format(max)}</span></figcaption>
      <div className="relative flex h-40 items-end gap-[2px] border-b border-line" aria-hidden>
        {rows.map((r) => (
          <div key={r.label} tabIndex={-1} className="group relative flex h-full flex-1 items-end">
            <span className="block w-full rounded-t-[4px] bg-info transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(2, (r.n / max) * 100)}%` }} />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-ink px-2 py-1 text-[11px] text-white opacity-0 shadow group-hover:opacity-100">{r.label}: {format(r.n)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted" aria-hidden><span>{rows[0].label}</span><span>{rows[rows.length - 1].label}</span></div>
      <details className="mt-2 text-[12px]"><summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-2 w-full text-left"><thead><tr><th className="py-1 font-medium text-muted">Period</th><th className="py-1 text-right font-medium text-muted">Value</th></tr></thead><tbody>{rows.map((r) => <tr key={r.label}><td className="py-0.5">{r.label}</td><td className="py-0.5 text-right tabular-nums">{format(r.n)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

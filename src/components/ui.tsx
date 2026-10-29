import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL, STATUS_TONE, type BookingStatus } from "@/lib/booking-state";

const TONES = { neutral: "bg-sand/70 text-ink", info: "bg-info-50 text-info", warn: "bg-warn-50 text-warn", ok: "bg-ok-50 text-ok", bad: "bg-bad-50 text-bad", gold: "bg-gold-50 text-gold-600" } as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TONES[tone]}`}>{children}</span>;
}
export const StatusBadge = ({ status }: { status: BookingStatus }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-[34px] leading-tight sm:text-[40px]">{title}</h1>
        {description && <p className="mt-2 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5"><h2 className="font-sans text-[15px] font-semibold text-navy">{title}</h2>{action}</div>}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const body = (
    <div className="card h-full p-4 transition-colors hover:border-gold/50">
      <p className="text-[12px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-display text-[30px] leading-none text-navy">{value}</p>
      {hint && <p className="mt-1.5 text-[12px] text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line bg-cream/50 px-6 py-10 text-center">
      <span aria-hidden className="mb-3 block h-px w-10 bg-gold" />
      <p className="font-display text-[20px] text-navy">{title}</p>
      {children && <p className="mt-1 max-w-md text-[14px] text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, name, hint, error, children }: { label: string; name: string; hint?: string; error?: string; children?: ReactNode }) {
  return (
    <div>
      <label htmlFor={name} className="label">{label}</label>
      {children}
      {hint && !error && <p id={`${name}-hint`} className="mt-1 text-[12px] text-muted">{hint}</p>}
      {error && <p id={`${name}-err`} className="mt-1 text-[12px] text-bad">{error}</p>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div role="status" className={`rounded-xl px-4 py-3 text-[14px] ${TONES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function DefList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}><dt className="text-[12px] uppercase tracking-wider text-muted">{k}</dt><dd className="mt-0.5 text-[14px]">{v ?? <span className="text-muted">—</span>}</dd></div>
      ))}
    </dl>
  );
}

export function Avatar({ name, src, size = 48 }: { name: string; src?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
    : <span aria-hidden className="inline-flex items-center justify-center rounded-full bg-navy font-display text-gold" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials}</span>;
}

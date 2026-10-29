import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL, STATUS_TONE, type BookingStatus } from "@/lib/booking-state";

const TONES = { neutral: "bg-sand text-ink", info: "bg-info-50 text-info", warn: "bg-warn-50 text-warn", ok: "bg-ok-50 text-ok", bad: "bg-bad-50 text-bad", gold: "bg-gold-50 text-gold-600" } as const;
const DOTS = { neutral: "bg-subtle", info: "bg-info", warn: "bg-warn", ok: "bg-ok", bad: "bg-bad", gold: "bg-gold" } as const;
export type Tone = keyof typeof TONES;

/** Status pill: colour plus a dot plus text, so meaning never depends on colour alone. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${TONES[tone]}`}><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} />{children}</span>;
}
export const StatusBadge = ({ status }: { status: BookingStatus }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-[26px] leading-tight sm:text-[30px]">{title}</h1>
        {description && <div className="mt-1.5 text-[15px] text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, action, children, className = "", description }: { title?: string; action?: ReactNode; children: ReactNode; className?: string; description?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div><h2 className="font-display text-[15px] font-bold tracking-[-0.01em] text-ink">{title}</h2>{description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}</div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const body = (
    <div className="card h-full p-4 transition-shadow hover:shadow-[var(--shadow-pop)]">
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <p className="mt-1.5 font-display text-[28px] font-bold leading-none tracking-[-0.02em] text-ink tabular-nums">{value}</p>
      {hint && <p className="mt-1.5 text-[12px] text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} prefetch={false} className="block rounded-[12px]">{body}</Link> : body;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[12px] border border-dashed border-line bg-cream/60 px-6 py-10 text-center">
      <span aria-hidden className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-navy-50 text-navy">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" /></svg>
      </span>
      <p className="font-display text-[16px] font-bold text-ink">{title}</p>
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
    <div role={tone === "bad" ? "alert" : "status"} className={`flex gap-3 rounded-[12px] px-4 py-3 text-[14px] ${TONES[tone]}`}>
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOTS[tone]}`} />
      <div>{title && <p className="font-semibold">{title}</p>}<div>{children}</div></div>
    </div>
  );
}

export function DefList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}><dt className="text-[12px] font-medium text-muted">{k}</dt><dd className="mt-0.5 text-[14px] text-ink">{v ?? <span className="text-subtle">—</span>}</dd></div>
      ))}
    </dl>
  );
}

export function Avatar({ name, src, size = 48 }: { name: string; src?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-full bg-sand object-cover" style={{ width: size, height: size }} />
    : <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-navy-50 font-display font-bold text-navy" style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}>{initials}</span>;
}

/** Horizontal step indicator used for onboarding and booking journeys. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined} className="flex items-center gap-2 text-[13px]">
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${i < current ? "bg-ok text-white" : i === current ? "bg-navy text-white" : "bg-sand text-muted"}`}>{i < current ? "✓" : i + 1}</span>
          <span className={i === current ? "font-semibold text-ink" : "text-muted"}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

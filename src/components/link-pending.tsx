"use client";
import { useLinkStatus } from "next/link";
/** Place inside a <Link>: a calm overlay while the destination loads (e.g. opening a profile preview). */
export function LinkPending({ label = "Opening…" }: { label?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <span role="status" className="absolute inset-0 z-10 flex items-center justify-center bg-surface/55 text-[13px] font-semibold text-navy backdrop-blur-[1px]"><span className="rounded-full bg-surface px-3 py-1.5 shadow-sm">{label}</span></span> : null;
}

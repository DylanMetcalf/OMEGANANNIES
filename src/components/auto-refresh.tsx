"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
/** Lightweight near-real-time refresh (server components re-render; no client cache of sensitive data). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const r = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") r.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [r, seconds]);
  return null;
}

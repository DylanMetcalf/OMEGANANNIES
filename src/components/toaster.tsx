"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";

type Toast = { id: number; text: string };
/** Global success toasts. Survive the form that triggered them unmounting (e.g. a button that disappears once used). */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      const id = Date.now() + Math.random();
      setItems((x) => [...x.slice(-2), { id, text }]);
      setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), text.length > 120 ? 14000 : 6000);
    };
    window.addEventListener("omega:toast", on);
    return () => window.removeEventListener("omega:toast", on);
  }, []);
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:pr-6">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-md animate-in items-start gap-3 rounded-[12px] bg-navy px-4 py-3 text-[14px] text-white shadow-[var(--shadow-pop)]">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          <span className="break-words">{t.text}</span>
          <button onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss" className="-mr-1 shrink-0 rounded p-0.5 text-white/70 hover:text-white"><X aria-hidden className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
export const toast = (text: string) => window.dispatchEvent(new CustomEvent("omega:toast", { detail: text }));

"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Profile preview as a side drawer (bottom sheet on phones). Its content is server-rendered from the URL
 * (?preview=slug), so the grid, filters, page and shortlist stay exactly as they were when it closes.
 */
export function ProfileDrawer({ closeHref, title, children }: { closeHref: string; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => { const d = ref.current; if (d && !d.open) { d.showModal(); d.focus(); } }, []); // focus the sheet, not the close button
  const close = () => router.replace(closeHref, { scroll: false });
  return (
    <dialog ref={ref} tabIndex={-1} onClose={close} onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === ref.current) close(); }} aria-label={title}
      className="m-0 mt-auto h-[92dvh] outline-none focus:outline-none focus-visible:outline-none max-h-none w-full max-w-none rounded-t-[20px] bg-surface p-0 shadow-[var(--shadow-pop)] open:animate-rise sm:ml-auto sm:mt-0 sm:h-full sm:max-w-[480px] sm:rounded-none">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-5 py-3 backdrop-blur">
        <p className="eyebrow">Profile preview</p>
        <button type="button" onClick={close} className="btn-ghost btn-sm" aria-label="Close preview and continue browsing"><X aria-hidden className="h-5 w-5" /></button>
      </div>
      <div className="pb-[calc(env(safe-area-inset-bottom)+24px)]">{children}</div>
    </dialog>
  );
}

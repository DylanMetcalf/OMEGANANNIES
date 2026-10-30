"use client";
import { useOptimistic, useState, useTransition } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { toggleShortlistAction } from "@/app/family/journey-actions";
import { toast } from "@/components/toaster";

/**
 * Shortlist toggle with instant, honest feedback: the state flips optimistically, the server confirms, and on
 * failure the button reverts and says why. Broadcasts the new count for the shortlist bar and mobile action.
 */
export function ShortlistButton({ nannyId, name, saved, variant = "icon" }: { nannyId: string; name: string; saved: boolean; variant?: "icon" | "button" }) {
  const [real, setReal] = useState(saved);
  const [shown, setShown] = useOptimistic(real);
  const [pending, start] = useTransition();
  const [bump, setBump] = useState(0);
  const click = () => start(async () => {
    setShown(!real);
    setBump((b) => b + 1);
    const r = await toggleShortlistAction(nannyId);
    if ("error" in r) { toast(r.error); return; }
    setReal(r.saved);
    window.dispatchEvent(new CustomEvent("omega:shortlist", { detail: r.count }));
    toast(r.saved ? `${name} added to your shortlist` : `${name} removed from your shortlist`);
  });
  const label = shown ? `Remove ${name} from shortlist` : `Add ${name} to shortlist`;
  const Ico = shown ? BookmarkCheck : Bookmark;
  if (variant === "button") return (
    <button type="button" onClick={click} aria-pressed={shown} aria-busy={pending} className={shown ? "btn-secondary border-navy/40 bg-navy-50 text-navy" : "btn-secondary"}>
      <Ico key={bump} aria-hidden className="h-[18px] w-[18px] animate-pop" />{shown ? "Shortlisted" : "Add to shortlist"}
    </button>
  );
  return (
    <button type="button" onClick={click} aria-pressed={shown} aria-label={label} title={label} aria-busy={pending}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full shadow-sm ring-1 backdrop-blur transition-colors ${shown ? "bg-navy text-white ring-navy" : "bg-surface/90 text-ink ring-line hover:bg-surface hover:text-navy"}`}>
      <Ico key={bump} aria-hidden className={`h-[18px] w-[18px] ${bump ? "animate-pop" : ""}`} strokeWidth={2} />
    </button>
  );
}

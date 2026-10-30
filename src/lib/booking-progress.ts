/**
 * Family-facing booking progress, derived only from real booking state (never simulated). Stages that don't apply
 * to this booking are left out; terminal states (cancelled, declined, refunds, disputes) return null.
 */
export type ProgressInput = { status: string; preferredNannyIds: string[]; assistanceRequested: boolean; nannyId: string | null; nannyResponse: string | null };
export type Stage = { key: string; label: string; state: "done" | "current" | "todo"; next?: string };

const ORDER = ["enquiry", "matching", "introduction", "quotation", "awaiting_approval", "awaiting_payment", "confirmed", "in_progress", "completed"];
export function progressStages(b: ProgressInput): Stage[] | null {
  const at = ORDER.indexOf(b.status);
  if (at < 0) return null;
  const nannyPending = !!b.nannyId && b.nannyResponse === "pending";
  const nannyAccepted = !!b.nannyId && (b.nannyResponse === "accepted" || at >= ORDER.indexOf("awaiting_approval"));
  const reviewing = at <= ORDER.indexOf("quotation") && !b.nannyId;
  const raw: (Omit<Stage, "state"> & { done: boolean; current: boolean; show?: boolean })[] = [
    { key: "received", label: "Request received", done: true, current: false },
    { key: "prefs", label: b.assistanceRequested && !b.preferredNannyIds.length ? "Omega is choosing for you" : "Nanny preferences submitted", done: true, current: false, show: b.preferredNannyIds.length > 0 || b.assistanceRequested },
    { key: "review", label: "Omega reviewing", done: !!b.nannyId || at >= ORDER.indexOf("awaiting_approval"), current: reviewing, next: "We're checking availability and finding the best match. We reply within 4 hours." },
    { key: "nanny", label: "Nanny confirming", done: nannyAccepted, current: nannyPending, next: "We've offered your booking to the nanny and are waiting for them to confirm." },
    { key: "quote", label: "Quotation issued", done: at >= ORDER.indexOf("awaiting_approval"), current: nannyAccepted && at <= ORDER.indexOf("quotation"), next: "Your nanny has accepted. We're preparing your quotation." },
    { key: "approve", label: "Your approval", done: at >= ORDER.indexOf("awaiting_payment"), current: b.status === "awaiting_approval", next: "Review your quotation and accept it to hold your nanny's dates." },
    { key: "pay", label: "Deposit", done: at >= ORDER.indexOf("confirmed"), current: b.status === "awaiting_payment", next: "Pay the deposit — your booking is confirmed as soon as payment is verified." },
    { key: "confirmed", label: b.status === "completed" ? "Completed" : "Booking confirmed", done: at >= ORDER.indexOf("confirmed"), current: false },
  ];
  return raw.filter((s) => s.show !== false).map(({ done, current, show: _show, ...s }) => ({ ...s, state: current ? "current" : done ? "done" : "todo" }));
}

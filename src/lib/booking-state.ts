export const STATUSES = ["enquiry", "matching", "introduction", "quotation", "awaiting_approval", "awaiting_payment", "confirmed", "in_progress", "completed", "declined", "cancelled", "refund_pending", "refunded", "disputed"] as const;
export type BookingStatus = (typeof STATUSES)[number];
export type Actor = "family" | "nanny" | "management" | "system";

/** Allowed transitions and which actors may perform them. Adjust once Omega confirms its exact workflow. */
const T: Record<BookingStatus, Partial<Record<BookingStatus, Actor[]>>> = {
  enquiry: { matching: ["management"], declined: ["management"], cancelled: ["family", "management"] },
  matching: { introduction: ["management"], quotation: ["management"], declined: ["management"], cancelled: ["family", "management"] },
  introduction: { quotation: ["management"], matching: ["management"], declined: ["management"], cancelled: ["family", "management"] },
  quotation: { awaiting_approval: ["management"], matching: ["management"], declined: ["management"], cancelled: ["family", "management"] },
  awaiting_approval: { awaiting_payment: ["family"], quotation: ["management"], declined: ["management"], cancelled: ["family", "management"] },
  awaiting_payment: { confirmed: ["system", "management"], quotation: ["management"], cancelled: ["family", "management"] },
  confirmed: { in_progress: ["nanny", "management"], cancelled: ["family", "management"], disputed: ["family", "management"], refund_pending: ["management"] },
  in_progress: { completed: ["nanny", "management"], disputed: ["family", "management"] },
  completed: { disputed: ["family", "management"], refund_pending: ["management"] },
  cancelled: { refund_pending: ["management"] },
  refund_pending: { refunded: ["system", "management"], disputed: ["management"] },
  disputed: { completed: ["management"], refund_pending: ["management"], cancelled: ["management"] },
  declined: {},
  refunded: {},
};

export function canTransition(from: BookingStatus, to: BookingStatus, actor: Actor): boolean {
  return T[from]?.[to]?.includes(actor) ?? false;
}
export function nextStatuses(from: BookingStatus, actor: Actor): BookingStatus[] {
  return (Object.entries(T[from] ?? {}) as [BookingStatus, Actor[]][]).filter(([, a]) => a.includes(actor)).map(([s]) => s);
}
/** Statuses in which a booking holds the nanny's time (DB exclusion constraint applies). */
export const BLOCKING: BookingStatus[] = ["awaiting_payment", "confirmed", "in_progress"];
export const ACTIVE: BookingStatus[] = ["enquiry", "matching", "introduction", "quotation", "awaiting_approval", "awaiting_payment", "confirmed", "in_progress"];
export const TERMINAL: BookingStatus[] = ["declined", "refunded"];

export const STATUS_LABEL: Record<BookingStatus, string> = {
  enquiry: "Enquiry received", matching: "Finding your nanny", introduction: "Introduction", quotation: "Preparing quote",
  awaiting_approval: "Quote ready for you", awaiting_payment: "Awaiting payment", confirmed: "Confirmed", in_progress: "In progress",
  completed: "Completed", declined: "Declined", cancelled: "Cancelled", refund_pending: "Refund pending", refunded: "Refunded", disputed: "Under review",
};
export const STATUS_TONE: Record<BookingStatus, "neutral" | "info" | "warn" | "ok" | "bad" | "gold"> = {
  enquiry: "info", matching: "info", introduction: "info", quotation: "info", awaiting_approval: "gold", awaiting_payment: "warn",
  confirmed: "ok", in_progress: "ok", completed: "neutral", declined: "bad", cancelled: "bad", refund_pending: "warn", refunded: "neutral", disputed: "bad",
};

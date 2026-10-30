import "server-only";
import { syncBookingSoon } from "./calendar/sync";

/**
 * Side effects that must run after a booking change has committed (never inside the transaction, so a slow or
 * failing external service can't roll back or delay the booking itself). Each is idempotent and retried by the
 * scheduled maintenance job.
 */
type Hook = (bookingId: string, to: string) => Promise<void> | void;
const hooks: Hook[] = [
  (id) => syncBookingSoon(id),
  (id, to) => import("./growth").then((m) => m.onBookingForGrowth(id, to)), // lazy: avoids an import cycle with bookings
];
export function registerBookingHook(h: Hook) { hooks.push(h); }
export function afterBookingChange(bookingId: string, to: string) {
  for (const h of hooks) { try { void Promise.resolve(h(bookingId, to)).catch(() => undefined); } catch { /* recorded by the hook */ } }
}

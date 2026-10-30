import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { audit } from "../audit";
import { env } from "../env";
import { randomToken, safeEqual, sha256 } from "../crypto";
import { provider, ProviderError, type InEvent, type ProviderId } from "./providers";

/**
 * Two-way calendar synchronisation.
 * Source of truth: Omega owns every booking event it writes. An outside edit or deletion of such an event never changes
 * the booking — it is recorded as a conflict for management to resolve (restore, or reschedule through Omega).
 * Busy periods from a nanny's own calendar are imported as start/end times only (no titles, attendees or notes) and
 * reduce availability in discovery and matching; they never cancel or move a confirmed booking.
 */
const PUSH_STATUSES = ["confirmed", "in_progress"];
type Conn = typeof s.calendarConnections.$inferSelect;

// ---------- Token encryption (AES-256-GCM, key derived from APP_SECRET or CALENDAR_TOKEN_KEY) ----------
const key = () => Buffer.from(hkdfSync("sha256", process.env.CALENDAR_TOKEN_KEY || env.secret(), "omega-calendar", "token-encryption", 32));
export function seal(plain: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}
export function unseal(sealed: string): string {
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== "v1") throw new Error("Unknown token format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

// ---------- OAuth state (signed, short-lived, bound to the user) ----------
export const redirectUri = (p: ProviderId) => `${env.appUrl}/api/calendar/oauth/${p}`;
export function beginOAuth(userId: string, p: ProviderId) {
  const verifier = randomToken(48), state = randomToken(24);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const payload = Buffer.from(JSON.stringify({ u: userId, p, s: state, v: verifier, e: Date.now() + 10 * 60_000 })).toString("base64url");
  const cookie = `${payload}.${createHmac("sha256", env.secret()).update(payload).digest("base64url")}`;
  return { url: provider(p).authUrl({ state, challenge, redirectUri: redirectUri(p) }), cookie };
}
export function readOAuthCookie(cookie: string | undefined, userId: string, p: ProviderId, state: string | null): { verifier: string } | null {
  if (!cookie || !state) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig || !safeEqual(sig, createHmac("sha256", env.secret()).update(payload).digest("base64url"))) return null;
  const j = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; p: string; s: string; v: string; e: number };
  if (j.u !== userId || j.p !== p || j.e < Date.now() || !safeEqual(j.s, state)) return null;
  return { verifier: j.v };
}

export async function completeOAuth(userId: string, p: ProviderId, code: string, verifier: string) {
  const prov = provider(p);
  const t = await prov.exchangeCode({ code, verifier, redirectUri: redirectUri(p) });
  const email = await prov.accountEmail(t.accessToken).catch(() => null);
  const values = { userId, provider: p, accountEmail: email, accessTokenEnc: seal(t.accessToken), refreshTokenEnc: t.refreshToken ? seal(t.refreshToken) : null, tokenExpiresAt: t.expiresAt, scopes: t.scope ?? null, status: "active", lastError: null, failures: 0, syncToken: null, updatedAt: new Date() };
  const [c] = await db.insert(s.calendarConnections).values(values).onConflictDoUpdate({ target: [s.calendarConnections.userId, s.calendarConnections.provider], set: { ...values, refreshTokenEnc: values.refreshTokenEnc ?? sql`${s.calendarConnections.refreshTokenEnc}` } }).returning();
  await audit(userId, "calendar.connect", "calendar_connection", c.id, { provider: p });
  await ensureWatch(c).catch(() => undefined);
  await syncIncoming(c.id).catch(() => undefined);
  await pushAllForUser(userId).catch(() => undefined);
  return c;
}

/** Valid access token, refreshing when it expires within a minute. Revoked access marks the connection for re-authorisation. */
async function accessToken(c: Conn): Promise<string> {
  if (c.status === "disconnected" || !c.accessTokenEnc) throw new ProviderError("Calendar is disconnected", 0, true);
  if (c.tokenExpiresAt && c.tokenExpiresAt.getTime() > Date.now() + 60_000) return unseal(c.accessTokenEnc);
  if (!c.refreshTokenEnc) { await markReauth(c, "Access expired"); throw new ProviderError("Access expired", 401, true); }
  try {
    const t = await provider(c.provider as ProviderId).refresh(unseal(c.refreshTokenEnc));
    await db.update(s.calendarConnections).set({ accessTokenEnc: seal(t.accessToken), ...(t.refreshToken ? { refreshTokenEnc: seal(t.refreshToken) } : {}), tokenExpiresAt: t.expiresAt, updatedAt: new Date() }).where(eq(s.calendarConnections.id, c.id));
    return t.accessToken;
  } catch (e) {
    if (e instanceof ProviderError && e.reauth) await markReauth(c, "Access was revoked or expired — please reconnect");
    throw e;
  }
}
async function markReauth(c: Conn, why: string) { await db.update(s.calendarConnections).set({ status: "needs_reauth", lastError: why, updatedAt: new Date() }).where(eq(s.calendarConnections.id, c.id)); }
async function withToken<T>(c: Conn, f: (t: string) => Promise<T>): Promise<T> {
  try { return await f(await accessToken(c)); } catch (e) {
    if (e instanceof ProviderError && e.status === 401) { await markReauth(c, "Access was revoked — please reconnect"); }
    throw e;
  }
}

export async function disconnect(userId: string, connectionId: string) {
  const [c] = await db.select().from(s.calendarConnections).where(and(eq(s.calendarConnections.id, connectionId), eq(s.calendarConnections.userId, userId)));
  if (!c) return false;
  // Best effort: remove Omega's events from the external calendar, then forget tokens and busy periods.
  const links = await db.select().from(s.calendarEventLinks).where(eq(s.calendarEventLinks.connectionId, c.id));
  await withToken(c, async (t) => { for (const l of links) if (l.providerEventId) await provider(c.provider as ProviderId).deleteEvent(t, c.calendarId, l.providerEventId).catch(() => undefined); }).catch(() => undefined);
  await db.delete(s.calendarConnections).where(eq(s.calendarConnections.id, c.id)); // cascades links, busy blocks, conflicts
  await audit(userId, "calendar.disconnect", "calendar_connection", c.id, { provider: c.provider });
  return true;
}

// ---------- Outbound: Omega bookings → external calendars ----------
const hashOf = (start: Date, end: Date, summary: string) => sha256(`${start.toISOString()}|${end.toISOString()}|${summary}`);
/** Users whose calendars should carry this booking: the assigned nanny and the family's members. */
async function participants(b: typeof s.bookings.$inferSelect) {
  const nanny = b.nannyId ? await db.select({ userId: s.nannies.userId, name: s.nannies.displayName }).from(s.nannies).where(eq(s.nannies.id, b.nannyId)) : [];
  const fam = b.familyId ? await db.select({ userId: s.familyMembers.userId }).from(s.familyMembers).where(eq(s.familyMembers.familyId, b.familyId)) : [];
  return { nannyUser: nanny[0]?.userId ?? null, nannyName: nanny[0]?.name ?? "your nanny", familyUsers: fam.map((f) => f.userId) };
}

/** Bring every connected calendar for this booking in line with Omega's state. Safe to call repeatedly. */
export async function syncBooking(bookingId: string): Promise<{ written: number; deleted: number; errors: number }> {
  const out = { written: 0, deleted: 0, errors: 0 };
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, bookingId));
  if (!b) return out;
  const { nannyUser, nannyName, familyUsers } = await participants(b);
  const users = [...new Set([...(nannyUser ? [nannyUser] : []), ...familyUsers])];
  const conns = users.length ? await db.select().from(s.calendarConnections).where(and(inArray(s.calendarConnections.userId, users), eq(s.calendarConnections.pushBookings, true), eq(s.calendarConnections.status, "active"))) : [];
  // Connections that previously received events for this booking but no longer qualify (e.g. nanny reassigned).
  const stale = await db.select().from(s.calendarEventLinks).where(and(eq(s.calendarEventLinks.bookingId, b.id), ne(s.calendarEventLinks.status, "deleted")));
  const active = PUSH_STATUSES.includes(b.status);
  const sessions = active ? await db.select().from(s.bookingSessions).where(eq(s.bookingSessions.bookingId, b.id)) : [];
  const area = b.serviceLocationId ? (await db.select({ a: s.serviceLocations.area }).from(s.serviceLocations).where(eq(s.serviceLocations.id, b.serviceLocationId)))[0]?.a : b.areaText;
  for (const c of conns) {
    const isNanny = c.userId === nannyUser;
    // Minimal, privacy-safe content: no address, no children's names or care details.
    const summary = isNanny ? `Omega booking ${b.reference}${area ? ` · ${area}` : ""}` : `Nanny care with ${nannyName} · Omega Nannies`;
    const description = `Booking ${b.reference}. Details: ${env.appUrl}/${isNanny ? "nanny" : "family"}/bookings/${b.id}\nManaged by Omega Nannies — changes made here are not applied to the booking.`;
    try {
      await withToken(c, async (t) => {
        const links = await db.select().from(s.calendarEventLinks).where(and(eq(s.calendarEventLinks.connectionId, c.id), eq(s.calendarEventLinks.bookingId, b.id)));
        for (const x of sessions) {
          let l = links.find((k) => k.sessionStart?.getTime() === x.startsAt.getTime());
          const h = hashOf(x.startsAt, x.endsAt, summary);
          if (l && l.status === "synced" && l.contentHash === h) continue; // already correct — no duplicate write
          if (l?.status === "conflict") continue; // waiting for management's decision
          if (!l) {
            // Claim the session before creating the external event, so two concurrent syncs can't both create it.
            const [claim] = await db.insert(s.calendarEventLinks).values({ connectionId: c.id, bookingId: b.id, sessionStart: x.startsAt, status: "pending" }).onConflictDoNothing().returning();
            if (!claim) continue; // another sync is creating it right now
            l = claim;
          } else if (l.status === "pending" && !l.providerEventId && l.updatedAt.getTime() > Date.now() - 120_000) continue; // in flight elsewhere
          const r = await provider(c.provider as ProviderId).upsertEvent(t, c.calendarId, { summary, description, start: x.startsAt, end: x.endsAt, omegaKey: `${b.id}:${x.startsAt.toISOString()}` }, l?.providerEventId);
          await db.insert(s.calendarEventLinks).values({ connectionId: c.id, bookingId: b.id, sessionStart: x.startsAt, providerEventId: r.id, etag: r.etag, contentHash: h, status: "synced" })
            .onConflictDoUpdate({ target: [s.calendarEventLinks.connectionId, s.calendarEventLinks.bookingId, s.calendarEventLinks.sessionStart], set: { providerEventId: r.id, etag: r.etag ?? null, contentHash: h, status: "synced", lastError: null, updatedAt: new Date() } });
          out.written++;
        }
        // Sessions that no longer exist (cancelled, rescheduled, shortened) → remove their events.
        for (const l of links.filter((k) => k.status !== "deleted" && !sessions.some((x) => x.startsAt.getTime() === k.sessionStart?.getTime()))) {
          if (l.providerEventId) await provider(c.provider as ProviderId).deleteEvent(t, c.calendarId, l.providerEventId);
          await db.update(s.calendarEventLinks).set({ status: "deleted", updatedAt: new Date() }).where(eq(s.calendarEventLinks.id, l.id));
          out.deleted++;
        }
      });
      await db.update(s.calendarConnections).set({ failures: 0, lastError: null }).where(eq(s.calendarConnections.id, c.id));
    } catch (e) {
      out.errors++;
      await db.update(s.calendarConnections).set({ failures: sql`${s.calendarConnections.failures} + 1`, lastError: String((e as Error).message).slice(0, 300), updatedAt: new Date() }).where(eq(s.calendarConnections.id, c.id));
    }
  }
  // Remove events from calendars that no longer belong to this booking's participants.
  for (const l of stale.filter((k) => !conns.some((c) => c.id === k.connectionId))) {
    const [c] = await db.select().from(s.calendarConnections).where(eq(s.calendarConnections.id, l.connectionId));
    if (!c) continue;
    try { await withToken(c, (t) => (l.providerEventId ? provider(c.provider as ProviderId).deleteEvent(t, c.calendarId, l.providerEventId) : Promise.resolve())); await db.update(s.calendarEventLinks).set({ status: "deleted", updatedAt: new Date() }).where(eq(s.calendarEventLinks.id, l.id)); out.deleted++; }
    catch { out.errors++; }
  }
  return out;
}
/** Fire-and-forget hook used after booking changes. Failures are recorded on the connection and retried by the scheduled job. */
export function syncBookingSoon(bookingId: string) { void syncBooking(bookingId).catch(() => undefined); }

async function pushAllForUser(userId: string) {
  const nanny = await db.select({ id: s.nannies.id }).from(s.nannies).where(eq(s.nannies.userId, userId));
  const fams = await db.select({ id: s.familyMembers.familyId }).from(s.familyMembers).where(eq(s.familyMembers.userId, userId));
  const rows = await db.select({ id: s.bookings.id }).from(s.bookings).where(and(inArray(s.bookings.status, PUSH_STATUSES as never), or(nanny.length ? inArray(s.bookings.nannyId, nanny.map((n) => n.id)) : sql`false`, fams.length ? inArray(s.bookings.familyId, fams.map((f) => f.id)) : sql`false`)));
  for (const r of rows) await syncBooking(r.id);
}

// ---------- Inbound: external changes → busy periods and conflicts ----------
export async function syncIncoming(connectionId: string): Promise<{ busy: number; conflicts: number }> {
  const [c] = await db.select().from(s.calendarConnections).where(eq(s.calendarConnections.id, connectionId));
  if (!c || c.status !== "active") return { busy: 0, conflicts: 0 };
  const [nanny] = await db.select({ id: s.nannies.id }).from(s.nannies).where(eq(s.nannies.userId, c.userId));
  let res: { events: InEvent[]; nextSyncToken: string | null };
  const window = { from: new Date(Date.now() - 86400_000), to: new Date(Date.now() + 180 * 86400_000) };
  try {
    res = await withToken(c, (t) => provider(c.provider as ProviderId).listChanges(t, c.calendarId, c.syncToken, window));
  } catch (e) {
    if (e instanceof ProviderError && e.status === 410) { // token expired: full resync from a clean slate
      await db.update(s.calendarConnections).set({ syncToken: null }).where(eq(s.calendarConnections.id, c.id));
      await db.delete(s.calendarBusyBlocks).where(eq(s.calendarBusyBlocks.connectionId, c.id));
      res = await withToken(c, (t) => provider(c.provider as ProviderId).listChanges(t, c.calendarId, null, window));
    } else {
      await db.update(s.calendarConnections).set({ failures: sql`${s.calendarConnections.failures} + 1`, lastError: String((e as Error).message).slice(0, 300) }).where(eq(s.calendarConnections.id, c.id));
      throw e;
    }
  }
  let busy = 0, conflicts = 0;
  const links = await db.select().from(s.calendarEventLinks).where(and(eq(s.calendarEventLinks.connectionId, c.id), ne(s.calendarEventLinks.status, "deleted")));
  for (const ev of res.events) {
    const link = links.find((l) => l.providerEventId === ev.id);
    if (link) { // An Omega-owned event: detect outside edits, never apply them to the booking.
      const sess = link.sessionStart ? (await db.select().from(s.bookingSessions).where(and(eq(s.bookingSessions.bookingId, link.bookingId), eq(s.bookingSessions.startsAt, link.sessionStart))))[0] : undefined;
      const moved = !ev.cancelled && sess && ev.start && ev.end && (ev.start.getTime() !== sess.startsAt.getTime() || ev.end.getTime() !== sess.endsAt.getTime());
      if ((ev.cancelled || moved) && link.status !== "conflict") {
        await db.update(s.calendarEventLinks).set({ status: "conflict", updatedAt: new Date() }).where(eq(s.calendarEventLinks.id, link.id));
        conflicts += await raiseConflict(c, link.bookingId, ev.cancelled ? "event_deleted" : "event_moved", ev.cancelled ? "The Omega booking event was deleted from the connected calendar." : `The Omega booking event was moved to ${ev.start!.toISOString()} in the connected calendar.`);
      }
      continue;
    }
    if (ev.omegaKey) continue; // our own event from another connection; ignore
    if (!nanny || !c.importBusy) continue; // busy periods only protect nanny availability, and only with consent
    if (ev.cancelled || !ev.busy || !ev.start || !ev.end) {
      await db.delete(s.calendarBusyBlocks).where(and(eq(s.calendarBusyBlocks.connectionId, c.id), eq(s.calendarBusyBlocks.providerEventId, ev.id)));
      continue;
    }
    await db.insert(s.calendarBusyBlocks).values({ connectionId: c.id, nannyId: nanny.id, providerEventId: ev.id, startsAt: ev.start, endsAt: ev.end })
      .onConflictDoUpdate({ target: [s.calendarBusyBlocks.connectionId, s.calendarBusyBlocks.providerEventId], set: { startsAt: ev.start, endsAt: ev.end, updatedAt: new Date() } });
    busy++;
    const clash = await db.select({ bookingId: s.bookingSessions.bookingId }).from(s.bookingSessions).innerJoin(s.bookings, eq(s.bookings.id, s.bookingSessions.bookingId))
      .where(and(eq(s.bookingSessions.nannyId, nanny.id), inArray(s.bookings.status, PUSH_STATUSES as never), lt(s.bookingSessions.startsAt, ev.end), gt(s.bookingSessions.endsAt, ev.start))).limit(1);
    if (clash[0]) conflicts += await raiseConflict(c, clash[0].bookingId, "busy_overlaps_booking", "The nanny's own calendar shows a busy period during a confirmed Omega booking.");
  }
  await db.update(s.calendarConnections).set({ syncToken: res.nextSyncToken ?? c.syncToken, lastSyncAt: new Date(), failures: 0, lastError: null }).where(eq(s.calendarConnections.id, c.id));
  return { busy, conflicts };
}
async function raiseConflict(c: Conn, bookingId: string, kind: string, detail: string) {
  const open = await db.select({ id: s.calendarConflicts.id }).from(s.calendarConflicts).where(and(eq(s.calendarConflicts.connectionId, c.id), eq(s.calendarConflicts.bookingId, bookingId), eq(s.calendarConflicts.kind, kind), eq(s.calendarConflicts.status, "open")));
  if (open.length) return 0;
  await db.insert(s.calendarConflicts).values({ connectionId: c.id, bookingId, kind, detail });
  const [b] = await db.select({ ref: s.bookings.reference }).from(s.bookings).where(eq(s.bookings.id, bookingId));
  await db.insert(s.tasks).values({ title: `Calendar conflict on ${b?.ref ?? "a booking"}`, notes: `${detail} The booking itself was not changed. Resolve in Administration → Calendar conflicts.`, priority: "high", bookingId });
  return 1;
}

/** Management decision on a conflict. "restore" re-writes Omega's event; "dismiss" closes it (e.g. after rescheduling in Omega). */
export async function resolveConflict(userId: string, conflictId: string, action: "restore" | "dismiss") {
  const [x] = await db.select().from(s.calendarConflicts).where(and(eq(s.calendarConflicts.id, conflictId), eq(s.calendarConflicts.status, "open")));
  if (!x) return false;
  if (action === "restore" && x.bookingId) {
    await db.update(s.calendarEventLinks).set({ status: "pending", contentHash: null, updatedAt: new Date() }).where(and(eq(s.calendarEventLinks.connectionId, x.connectionId), eq(s.calendarEventLinks.bookingId, x.bookingId), eq(s.calendarEventLinks.status, "conflict")));
    await syncBooking(x.bookingId);
  } else if (x.bookingId) {
    await db.update(s.calendarEventLinks).set({ status: "synced", updatedAt: new Date() }).where(and(eq(s.calendarEventLinks.connectionId, x.connectionId), eq(s.calendarEventLinks.bookingId, x.bookingId), eq(s.calendarEventLinks.status, "conflict")));
  }
  await db.update(s.calendarConflicts).set({ status: action === "restore" ? "restored" : "dismissed", resolvedBy: userId, resolvedAt: new Date() }).where(eq(s.calendarConflicts.id, x.id));
  await audit(userId, `calendar.conflict_${action}`, "calendar_conflict", x.id, { bookingId: x.bookingId });
  return true;
}

// ---------- Webhooks & scheduled maintenance ----------
export async function ensureWatch(c: Conn) {
  if (!process.env.CALENDAR_WEBHOOK_BASE && !env.appUrl.startsWith("https://")) return; // providers only call public https endpoints
  if (c.channelExpiresAt && c.channelExpiresAt.getTime() > Date.now() + 12 * 3600_000) return;
  const channelId = randomToken(16), token = randomToken(32);
  const base = process.env.CALENDAR_WEBHOOK_BASE || env.appUrl;
  const w = await withToken(c, (t) => provider(c.provider as ProviderId).watch(t, c.calendarId, { address: `${base}/api/calendar/webhook/${c.provider}`, channelId, token }));
  await db.update(s.calendarConnections).set({ channelId, channelTokenHash: sha256(token), channelResourceId: w.resourceId, channelExpiresAt: w.expiresAt }).where(eq(s.calendarConnections.id, c.id));
}
/** Verify a provider notification against the per-channel secret we registered, then return the connection. */
export async function connectionForWebhook(p: ProviderId, channel: string | null, secret: string | null) {
  if (!channel || !secret) return null;
  const [c] = await db.select().from(s.calendarConnections).where(and(eq(s.calendarConnections.provider, p), p === "google" ? eq(s.calendarConnections.channelId, channel) : eq(s.calendarConnections.channelResourceId, channel)));
  if (!c?.channelTokenHash || !safeEqual(c.channelTokenHash, sha256(secret))) return null;
  return c;
}
export async function calendarMaintenance() {
  const conns = await db.select().from(s.calendarConnections).where(eq(s.calendarConnections.status, "active"));
  let synced = 0, retried = 0;
  for (const c of conns) {
    await ensureWatch(c).catch(() => undefined);
    // Poll when no webhook is active or the last sync is stale (missed notifications, provider outages).
    if (!c.channelExpiresAt || !c.lastSyncAt || c.lastSyncAt.getTime() < Date.now() - 6 * 3600_000) { await syncIncoming(c.id).then(() => synced++).catch(() => undefined); }
  }
  // Retry outbound writes for connections that failed (backoff: skip ones that failed 8+ times until reconnected).
  const failing = await db.select({ userId: s.calendarConnections.userId }).from(s.calendarConnections).where(and(eq(s.calendarConnections.status, "active"), gt(s.calendarConnections.failures, 0), lt(s.calendarConnections.failures, 8)));
  for (const f of failing) { await pushAllForUser(f.userId).catch(() => undefined); retried++; }
  // Clear busy periods that have ended.
  await db.delete(s.calendarBusyBlocks).where(lt(s.calendarBusyBlocks.endsAt, new Date(Date.now() - 86400_000)));
  return { synced, retried };
}

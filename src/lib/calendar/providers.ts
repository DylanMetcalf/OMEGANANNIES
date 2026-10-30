import "server-only";

/**
 * Calendar provider adapters. Both use OAuth 2.0 authorization code + PKCE and request the minimum scopes:
 * calendar events only (no mail, contacts or files) plus the account's email address to label the connection.
 * Tests swap in a fake provider with setProviderForTests().
 */
export type ProviderId = "google" | "microsoft";
export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date; scope?: string };
export type OutEvent = { summary: string; description: string; start: Date; end: Date; omegaKey: string };
export type InEvent = { id: string; etag?: string; cancelled: boolean; busy: boolean; start: Date | null; end: Date | null; omegaKey?: string };
export class ProviderError extends Error { constructor(msg: string, public status = 0, public reauth = false) { super(msg); } }

export interface CalendarProvider {
  id: ProviderId;
  label: string;
  configured(): boolean;
  authUrl(p: { state: string; challenge: string; redirectUri: string }): string;
  exchangeCode(p: { code: string; verifier: string; redirectUri: string }): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  accountEmail(accessToken: string): Promise<string | null>;
  upsertEvent(accessToken: string, calendarId: string, ev: OutEvent, existingId?: string | null): Promise<{ id: string; etag?: string }>;
  deleteEvent(accessToken: string, calendarId: string, id: string): Promise<void>;
  /** Incremental changes since the last sync token (null = initial window). Throws status 410 when the token expired. */
  listChanges(accessToken: string, calendarId: string, syncToken: string | null, window: { from: Date; to: Date }): Promise<{ events: InEvent[]; nextSyncToken: string | null }>;
  watch(accessToken: string, calendarId: string, p: { address: string; channelId: string; token: string }): Promise<{ resourceId: string | null; expiresAt: Date }>;
}

async function call(url: string, init: RequestInit & { token?: string }): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401) throw new ProviderError("Calendar access expired", 401, true);
  return r;
}
async function form(url: string, body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, string | number>;
  if (!r.ok) throw new ProviderError(`Token request failed (${j.error ?? r.status})`, r.status, j.error === "invalid_grant");
  return { accessToken: String(j.access_token), refreshToken: j.refresh_token ? String(j.refresh_token) : null, expiresAt: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000), scope: j.scope ? String(j.scope) : undefined };
}

const google: CalendarProvider = {
  id: "google", label: "Google Calendar",
  configured: () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
  authUrl: ({ state, challenge, redirectUri }) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent",
    scope: "openid email https://www.googleapis.com/auth/calendar.events", state, code_challenge: challenge, code_challenge_method: "S256", include_granted_scopes: "false",
  })}`,
  exchangeCode: ({ code, verifier, redirectUri }) => form("https://oauth2.googleapis.com/token", { code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code", client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET! }),
  refresh: (refreshToken) => form("https://oauth2.googleapis.com/token", { refresh_token: refreshToken, grant_type: "refresh_token", client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET! }),
  async accountEmail(token) { const r = await call("https://openidconnect.googleapis.com/v1/userinfo", { token }); return r.ok ? ((await r.json()) as { email?: string }).email ?? null : null; },
  async upsertEvent(token, cal, ev, existingId) {
    const body = JSON.stringify({ summary: ev.summary, description: ev.description, start: { dateTime: ev.start.toISOString() }, end: { dateTime: ev.end.toISOString() }, transparency: "opaque", visibility: "private", extendedProperties: { private: { omegaKey: ev.omegaKey } }, reminders: { useDefault: true } });
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events`;
    let r = existingId ? await call(`${base}/${encodeURIComponent(existingId)}`, { method: "PUT", token, body, headers: { "Content-Type": "application/json" } }) : null;
    if (!r || r.status === 404 || r.status === 410) r = await call(base, { method: "POST", token, body, headers: { "Content-Type": "application/json" } });
    if (!r.ok) throw new ProviderError(`Google event write failed (${r.status})`, r.status);
    const j = (await r.json()) as { id: string; etag?: string };
    return { id: j.id, etag: j.etag };
  },
  async deleteEvent(token, cal, id) {
    const r = await call(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(id)}`, { method: "DELETE", token });
    if (!r.ok && r.status !== 404 && r.status !== 410) throw new ProviderError(`Google event delete failed (${r.status})`, r.status);
  },
  async listChanges(token, cal, syncToken, w) {
    const events: InEvent[] = []; let pageToken: string | undefined, next: string | null = null;
    do {
      const q = new URLSearchParams({ maxResults: "250", singleEvents: "true", showDeleted: "true", ...(syncToken ? { syncToken } : { timeMin: w.from.toISOString(), timeMax: w.to.toISOString() }), ...(pageToken ? { pageToken } : {}) });
      const r = await call(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events?${q}`, { token });
      if (r.status === 410) throw new ProviderError("Sync token expired", 410);
      if (!r.ok) throw new ProviderError(`Google sync failed (${r.status})`, r.status);
      const j = (await r.json()) as { items?: { id: string; etag?: string; status?: string; transparency?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; extendedProperties?: { private?: { omegaKey?: string } } }[]; nextPageToken?: string; nextSyncToken?: string };
      for (const e of j.items ?? []) {
        const s = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null), en = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null);
        events.push({ id: e.id, etag: e.etag, cancelled: e.status === "cancelled", busy: e.transparency !== "transparent", start: s ? new Date(s) : null, end: en ? new Date(en) : null, omegaKey: e.extendedProperties?.private?.omegaKey });
      }
      pageToken = j.nextPageToken; next = j.nextSyncToken ?? next;
    } while (pageToken);
    return { events, nextSyncToken: next };
  },
  async watch(token, cal, p) {
    const r = await call(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events/watch`, { method: "POST", token, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.channelId, type: "web_hook", address: p.address, token: p.token, params: { ttl: String(7 * 86400) } }) });
    if (!r.ok) throw new ProviderError(`Google watch failed (${r.status})`, r.status);
    const j = (await r.json()) as { resourceId?: string; expiration?: string };
    return { resourceId: j.resourceId ?? null, expiresAt: new Date(Number(j.expiration) || Date.now() + 7 * 86400_000) };
  },
};

const GRAPH = "https://graph.microsoft.com/v1.0";
const msTenant = () => process.env.MICROSOFT_TENANT_ID || "common";
const microsoft: CalendarProvider = {
  id: "microsoft", label: "Outlook / Microsoft 365",
  configured: () => !!process.env.MICROSOFT_CLIENT_ID && !!process.env.MICROSOFT_CLIENT_SECRET,
  authUrl: ({ state, challenge, redirectUri }) => `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/authorize?${new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", response_mode: "query",
    scope: "openid email offline_access https://graph.microsoft.com/Calendars.ReadWrite", state, code_challenge: challenge, code_challenge_method: "S256",
  })}`,
  exchangeCode: ({ code, verifier, redirectUri }) => form(`https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`, { code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code", client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET! }),
  refresh: (refreshToken) => form(`https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`, { refresh_token: refreshToken, grant_type: "refresh_token", client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET! }),
  async accountEmail(token) { const r = await call(`${GRAPH}/me?$select=mail,userPrincipalName`, { token }); if (!r.ok) return null; const j = (await r.json()) as { mail?: string; userPrincipalName?: string }; return j.mail ?? j.userPrincipalName ?? null; },
  async upsertEvent(token, _cal, ev, existingId) {
    const body = JSON.stringify({ subject: ev.summary, body: { contentType: "text", content: ev.description }, start: { dateTime: ev.start.toISOString().slice(0, 19), timeZone: "UTC" }, end: { dateTime: ev.end.toISOString().slice(0, 19), timeZone: "UTC" }, showAs: "busy", sensitivity: "private", singleValueExtendedProperties: [{ id: "String {66f5a359-4659-4830-9070-00047ec6ac6e} Name omegaKey", value: ev.omegaKey }] });
    let r = existingId ? await call(`${GRAPH}/me/events/${encodeURIComponent(existingId)}`, { method: "PATCH", token, body, headers: { "Content-Type": "application/json" } }) : null;
    if (!r || r.status === 404) r = await call(`${GRAPH}/me/calendar/events`, { method: "POST", token, body, headers: { "Content-Type": "application/json" } });
    if (!r.ok) throw new ProviderError(`Outlook event write failed (${r.status})`, r.status);
    const j = (await r.json()) as { id: string; "@odata.etag"?: string };
    return { id: j.id, etag: j["@odata.etag"] };
  },
  async deleteEvent(token, _cal, id) {
    const r = await call(`${GRAPH}/me/events/${encodeURIComponent(id)}`, { method: "DELETE", token });
    if (!r.ok && r.status !== 404) throw new ProviderError(`Outlook event delete failed (${r.status})`, r.status);
  },
  async listChanges(token, _cal, syncToken, w) {
    const events: InEvent[] = []; let url: string | null = syncToken ?? `${GRAPH}/me/calendarView/delta?startDateTime=${w.from.toISOString()}&endDateTime=${w.to.toISOString()}`; let next: string | null = null;
    while (url) {
      const r = await call(url, { token, headers: { Prefer: 'odata.maxpagesize=200, outlook.timezone="UTC"' } });
      if (r.status === 410) throw new ProviderError("Delta token expired", 410);
      if (!r.ok) throw new ProviderError(`Outlook sync failed (${r.status})`, r.status);
      const j = (await r.json()) as { value?: { id: string; "@removed"?: object; showAs?: string; isCancelled?: boolean; start?: { dateTime: string }; end?: { dateTime: string }; "@odata.etag"?: string }[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
      for (const e of j.value ?? []) events.push({ id: e.id, etag: e["@odata.etag"], cancelled: !!e["@removed"] || !!e.isCancelled, busy: !["free", "workingElsewhere"].includes(e.showAs ?? "busy"), start: e.start ? new Date(e.start.dateTime + "Z") : null, end: e.end ? new Date(e.end.dateTime + "Z") : null });
      url = j["@odata.nextLink"] ?? null; next = j["@odata.deltaLink"] ?? next;
    }
    return { events, nextSyncToken: next };
  },
  async watch(token, _cal, p) {
    const expiresAt = new Date(Date.now() + 2.5 * 86400_000); // Graph maximum for events is just under 3 days
    const r = await call(`${GRAPH}/subscriptions`, { method: "POST", token, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeType: "created,updated,deleted", notificationUrl: p.address, resource: "me/events", expirationDateTime: expiresAt.toISOString(), clientState: p.token }) });
    if (!r.ok) throw new ProviderError(`Outlook subscription failed (${r.status})`, r.status);
    const j = (await r.json()) as { id: string };
    return { resourceId: j.id, expiresAt };
  },
};

const REGISTRY: Record<ProviderId, CalendarProvider> = { google, microsoft };
let override: Partial<Record<ProviderId, CalendarProvider>> = {};
export const provider = (id: ProviderId): CalendarProvider => override[id] ?? REGISTRY[id];
export const PROVIDERS: ProviderId[] = ["google", "microsoft"];
export function setProviderForTests(id: ProviderId, p: CalendarProvider | null) { override = { ...override, [id]: p ?? undefined }; }

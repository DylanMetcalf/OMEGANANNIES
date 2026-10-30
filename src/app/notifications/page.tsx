import Link from "next/link";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";
import { markNotificationsReadAction } from "@/app/family/actions";

export const metadata = { title: "Notifications" };
export default async function Notifications() {
  const u = await requireUser();
  const rows = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, u.id), eq(s.notifications.channel, "in_app"))).orderBy(desc(s.notifications.createdAt)).limit(100);
  // Delivery history for the same events on other channels (own notifications only).
  const ext = rows.length ? await db.select({ key: s.notifications.dedupeKey, channel: s.notifications.channel, status: s.notifications.status }).from(s.notifications).where(and(eq(s.notifications.userId, u.id), ne(s.notifications.channel, "in_app"), inArray(s.notifications.dedupeKey, rows.map((r) => r.dedupeKey)))) : [];
  const LABEL: Record<string, string> = { pending: "queued", sent: "sent", delivered: "delivered", failed: "not delivered", captured: "not sent (demo)", skipped: "skipped" };
  return (
    <>
      <PageHeader eyebrow="Inbox" title="Notifications" actions={rows.some((r) => !r.readAt) ? <form action={markNotificationsReadAction}><button className="btn-secondary">Mark all as read</button></form> : null} />
      {rows.length ? <ul className="card divide-y divide-line">{rows.map((n) => (
        <li key={n.id}><Link href={n.link ?? "#"} className="flex gap-3 px-5 py-4 hover:bg-cream/60">
          <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-gold"}`} />
          <span className="min-w-0"><span className={`block text-[14px] ${n.readAt ? "text-ink" : "font-semibold text-ink"}`}>{n.subject}{!n.readAt && <span className="sr-only"> (unread)</span>}</span><span className="block text-[13px] text-muted">{n.body}</span><span className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted"><span>{fmtDateTime(n.createdAt)}</span>{ext.filter((e) => e.key === n.dedupeKey).map((e) => <span key={e.channel} className={e.status === "failed" ? "text-bad" : e.status === "delivered" ? "text-ok" : ""}>{e.channel === "whatsapp" ? "WhatsApp" : e.channel === "sms" ? "SMS" : "Email"}: {LABEL[e.status] ?? e.status}</span>)}</span></span>
        </Link></li>
      ))}</ul> : <Empty title="You’re all caught up" />}
    </>
  );
}

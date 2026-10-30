import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";
import { markNotificationsReadAction } from "@/app/family/actions";

export const metadata = { title: "Notifications" };
export default async function Notifications() {
  const u = await requireUser();
  const rows = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, u.id), eq(s.notifications.channel, "in_app"))).orderBy(desc(s.notifications.createdAt)).limit(100);
  return (
    <>
      <PageHeader eyebrow="Inbox" title="Notifications" actions={rows.some((r) => !r.readAt) ? <form action={markNotificationsReadAction}><button className="btn-secondary">Mark all as read</button></form> : null} />
      {rows.length ? <ul className="card divide-y divide-line">{rows.map((n) => (
        <li key={n.id}><Link href={n.link ?? "#"} className="flex gap-3 px-5 py-4 hover:bg-cream/60">
          <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-gold"}`} />
          <span className="min-w-0"><span className={`block text-[14px] ${n.readAt ? "text-ink" : "font-semibold text-ink"}`}>{n.subject}{!n.readAt && <span className="sr-only"> (unread)</span>}</span><span className="block text-[13px] text-muted">{n.body}</span><span className="block text-[12px] text-muted">{fmtDateTime(n.createdAt)}</span></span>
        </Link></li>
      ))}</ul> : <Empty title="You’re all caught up" />}
    </>
  );
}

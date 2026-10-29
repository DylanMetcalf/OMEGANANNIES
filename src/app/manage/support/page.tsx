import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/time";
import { moderateReviewAction, supportStatusAction } from "../actions";

export const metadata = { title: "Support & reviews" };
export default async function Support() {
  const u = await requireUser({ role: "management" });
  const reqs = await db.select({ r: s.supportRequests, who: s.users.name }).from(s.supportRequests).leftJoin(s.users, eq(s.users.id, s.supportRequests.userId)).orderBy(desc(s.supportRequests.createdAt)).limit(100);
  const reviews = can(u, "reviews.moderate") ? await db.select({ r: s.reviews, nanny: s.nannies.displayName, ref: s.bookings.reference, bid: s.bookings.id }).from(s.reviews).innerJoin(s.nannies, eq(s.nannies.id, s.reviews.nannyId)).innerJoin(s.bookings, eq(s.bookings.id, s.reviews.bookingId)).orderBy(desc(s.reviews.createdAt)).limit(50) : [];
  const tone = (c: string) => (c === "safeguarding" || c === "complaint" ? "bad" : c === "privacy" ? "warn" : "neutral");
  return (
    <>
      <PageHeader eyebrow="Care" title="Support & reviews" description="Complaints and safeguarding reports are kept separate from public reviews." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Support requests">
          {reqs.length ? <ul className="divide-y divide-line">{reqs.map(({ r, who }) => (
            <li key={r.id} className="py-3 text-[14px]">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-navy">{r.subject}</p><span className="flex gap-1.5"><Badge tone={tone(r.category)}>{r.category}</Badge><Badge tone={r.status === "resolved" ? "ok" : "warn"}>{r.status.replace("_", " ")}</Badge></span></div>
              <p className="text-muted">{r.body}</p><p className="text-[12px] text-muted">{who ?? "System"} · {fmtDateTime(r.createdAt)}{r.bookingId && <> · <Link className="link" href={`/manage/bookings/${r.bookingId}`}>booking</Link></>}</p>
              {r.status !== "resolved" && <ActionForm action={supportStatusAction} className="mt-2 flex gap-2"><input type="hidden" name="id" value={r.id} />{r.status === "open" && <Submit name="status" value="in_progress" className="btn-secondary btn-sm">Take</Submit>}<Submit name="status" value="resolved" className="btn-primary btn-sm">Resolve</Submit></ActionForm>}
            </li>
          ))}</ul> : <Empty title="No support requests" />}
        </Section>
        {can(u, "reviews.moderate") && (
          <Section title="Review moderation">
            {reviews.length ? <ul className="divide-y divide-line">{reviews.map(({ r, nanny, ref, bid }) => (
              <li key={r.id} className="py-3 text-[14px]">
                <div className="flex items-center justify-between"><p><span className="text-gold">{"★".repeat(r.rating)}</span> {nanny} · <Link className="link" href={`/manage/bookings/${bid}`}>{ref}</Link></p><Badge tone={r.status === "published" ? "ok" : r.status === "pending" ? "gold" : "neutral"}>{r.status}</Badge></div>
                <p className="mt-1">{r.body}</p>
                <ActionForm action={moderateReviewAction} className="mt-2 flex flex-wrap gap-2"><input type="hidden" name="id" value={r.id} /><input name="note" placeholder="Moderation note" aria-label="Note" className="input !w-auto flex-1 !py-1.5" />{r.status !== "published" && <Submit name="status" value="published" className="btn-primary btn-sm">Publish</Submit>}{r.status === "pending" && <Submit name="status" value="rejected" className="btn-secondary btn-sm">Reject</Submit>}{r.status === "published" && <Submit name="status" value="removed" className="btn-danger btn-sm">Remove</Submit>}</ActionForm>
              </li>
            ))}</ul> : <Empty title="No reviews yet" />}
          </Section>
        )}
      </div>
    </>
  );
}

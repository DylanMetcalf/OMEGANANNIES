import Link from "next/link";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/time";
import { saveTaskAction, taskStatusAction } from "../actions";

export const metadata = { title: "Tasks" };
export default async function Tasks({ searchParams }: { searchParams: Promise<{ view?: string; bookingId?: string; nannyId?: string; familyId?: string }> }) {
  const u = await requireUser({ role: "management" });
  const sp = await searchParams;
  const view = sp.view ?? "mine";
  const staff = await db.select({ id: s.users.id, name: s.users.name }).from(s.users).innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id)).where(and(inArray(s.userRoles.role, ["ops", "manager", "admin"]), eq(s.users.status, "active"))).groupBy(s.users.id, s.users.name);
  const where = view === "done" ? eq(s.tasks.status, "done") : view === "all" ? eq(s.tasks.status, "open") : and(eq(s.tasks.status, "open"), eq(s.tasks.assigneeId, u.id));
  const rows = await db.select({ t: s.tasks, assignee: s.users.name, ref: s.bookings.reference, nanny: s.nannies.displayName, family: s.families.displayName }).from(s.tasks)
    .leftJoin(s.users, eq(s.users.id, s.tasks.assigneeId)).leftJoin(s.bookings, eq(s.bookings.id, s.tasks.bookingId)).leftJoin(s.nannies, eq(s.nannies.id, s.tasks.nannyId)).leftJoin(s.families, eq(s.families.id, s.tasks.familyId))
    .where(where).orderBy(sql`${s.tasks.dueOn} NULLS LAST`, asc(s.tasks.createdAt)).limit(200);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader eyebrow="Operations" title="Tasks" description="Internal follow-ups — never visible to families or nannies." />
      <nav aria-label="Task views" className="mb-4 flex gap-1 rounded-[12px] bg-sand p-1 sm:w-fit">{[["mine", "Assigned to me"], ["all", "All open"], ["done", "Completed"]].map(([k, l]) => <Link key={k} href={`?view=${k}`} aria-current={view === k ? "page" : undefined} className={`rounded-[9px] px-3 py-2 text-[13px] font-medium ${view === k ? "bg-surface shadow-sm" : "text-muted"}`}>{l}</Link>)}</nav>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div>{rows.length ? <ul className="card divide-y divide-line">{rows.map(({ t, assignee, ref, nanny, family }) => (
          <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="font-semibold">{t.title} {t.priority === "high" && <Badge tone="bad">High</Badge>}</p>
              {t.notes && <p className="mt-0.5 text-[13px] text-muted">{t.notes}</p>}
              <p className="mt-1 text-[12px] text-muted">{t.dueOn && <span className={t.status === "open" && t.dueOn < today ? "font-semibold text-bad" : ""}>Due {fmtDate(t.dueOn)} · </span>}{assignee ?? "Unassigned"}
                {t.bookingId && <> · <Link className="link" href={`/manage/bookings/${t.bookingId}`}>{ref}</Link></>}{t.nannyId && <> · <Link className="link" href={`/manage/nannies/${t.nannyId}`}>{nanny}</Link></>}{t.familyId && <> · <Link className="link" href={`/manage/families/${t.familyId}`}>{family}</Link></>}</p>
            </div>
            <ActionForm action={taskStatusAction}><input type="hidden" name="taskId" value={t.id} /><Submit name="status" value={t.status === "open" ? "done" : "open"} className="btn-secondary btn-sm">{t.status === "open" ? "Mark done" : "Reopen"}</Submit></ActionForm>
          </li>
        ))}</ul> : <Empty title={view === "done" ? "No completed tasks" : "Nothing to do here"} />}</div>
        <Section title="New task">
          <ActionForm action={saveTaskAction} className="space-y-3" resetOnSuccess>
            {sp.bookingId && <input type="hidden" name="bookingId" value={sp.bookingId} />}{sp.nannyId && <input type="hidden" name="nannyId" value={sp.nannyId} />}{sp.familyId && <input type="hidden" name="familyId" value={sp.familyId} />}
            <div><label className="label" htmlFor="title">Task</label><input id="title" name="title" required className="input" /></div>
            <div><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} className="input" /></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="label" htmlFor="dueOn">Due</label><input id="dueOn" name="dueOn" type="date" className="input" /></div><div><label className="label" htmlFor="priority">Priority</label><select id="priority" name="priority" defaultValue="normal" className="input"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></div></div>
            <div><label className="label" htmlFor="assigneeId">Assign to</label><select id="assigneeId" name="assigneeId" defaultValue={u.id} className="input"><option value="">Unassigned</option>{staff.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            <Submit>Add task</Submit>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}

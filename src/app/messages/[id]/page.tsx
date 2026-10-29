import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { Notice, PageHeader } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireUser } from "@/lib/auth";
import { openThread } from "@/lib/messaging";
import { fmtDateTime } from "@/lib/time";
import { reportMessageAction, sendMessageAction } from "../actions";

export const metadata = { title: "Conversation" };
export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const t = await openThread(u, id);
  if (!t) notFound();
  return (
    <>
      <AutoRefresh seconds={15} />
      <PageHeader eyebrow={t.c.kind.replace(/_/g, " ")} title={t.c.subject} actions={<Link href="/messages" className="btn-secondary">All messages</Link>} />
      {!t.participant && <div className="mb-4"><Notice tone="warn">You are viewing this conversation under oversight permissions. This access has been recorded.</Notice></div>}
      <div className="card flex flex-col">
        <ol className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-5" aria-live="polite">
          {t.messages.map(({ m, sender, senderId }) => {
            const mine = senderId === u.id;
            return (
              <li key={m.id} className={`max-w-[85%] ${mine ? "self-end" : "self-start"}`}>
                <div className={`rounded-2xl px-4 py-2.5 text-[14px] ${mine ? "rounded-br-sm bg-navy text-white" : "rounded-bl-sm bg-cream"}`}>{m.body}</div>
                <div className={`mt-1 flex gap-2 text-[11px] text-muted ${mine ? "justify-end" : ""}`}>
                  <span>{mine ? "You" : sender} · {fmtDateTime(m.createdAt)}</span>
                  {m.flaggedAt && <span className="text-bad">Reported</span>}
                  {!mine && !m.flaggedAt && (
                    <details><summary className="cursor-pointer underline">Report</summary>
                      <ActionForm action={reportMessageAction} className="mt-1 flex gap-1"><input type="hidden" name="messageId" value={m.id} /><input name="reason" placeholder="Reason" className="input !py-1 text-[12px]" /><Submit className="btn-danger btn-sm">Report</Submit></ActionForm>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
          {!t.messages.length && <li className="text-center text-muted">No messages yet.</li>}
        </ol>
        {t.c.locked ? <p className="border-t border-line p-4 text-[13px] text-muted">This conversation is closed.</p> : (
          <ActionForm action={sendMessageAction} resetOnSuccess className="flex gap-2 border-t border-line p-4">
            <input type="hidden" name="conversationId" value={t.c.id} />
            <label htmlFor="body" className="sr-only">Message</label>
            <textarea id="body" name="body" rows={2} required maxLength={4000} className="input flex-1" placeholder="Write a message…" />
            <Submit pendingText="Sending…">Send</Submit>
          </ActionForm>
        )}
      </div>
    </>
  );
}

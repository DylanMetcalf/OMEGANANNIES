import Link from "next/link";
import { ActionForm, Submit } from "@/components/action-form";
import { Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listConversations, managementInbox } from "@/lib/messaging";
import { can, isManagement } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/time";
import { startConversationAction } from "./actions";

export const metadata = { title: "Messages" };
export default async function Messages() {
  const u = await requireUser();
  const mine = await listConversations(u);
  const oversight = can(u, "messages.oversee") ? (await managementInbox()).filter((c) => !mine.some((m) => m.id === c.id)) : [];
  return (
    <>
      <PageHeader eyebrow="Messages" title="Conversations" description="Messages are stored securely. The Omega team may review conversations for safeguarding and support; such access is logged." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Your conversations">
          {mine.length ? (
            <ul className="-my-2 divide-y divide-line">
              {mine.map((c) => (
                <li key={c.id}><Link href={`/messages/${c.id}`} className="flex items-start justify-between gap-4 py-3 hover:bg-cream/50">
                  <div className="min-w-0"><p className="font-medium text-navy">{c.subject}</p><p className="truncate text-[13px] text-muted">{c.last_body}</p></div>
                  <div className="shrink-0 text-right text-[12px] text-muted">{c.last_message_at && fmtDateTime(new Date(c.last_message_at))}{c.unread > 0 && <span className="ml-2 rounded-full bg-gold px-2 py-0.5 font-semibold text-navy">{c.unread}</span>}</div>
                </Link></li>
              ))}
            </ul>
          ) : <Empty title="No conversations yet">Start one with our team — we reply within 4 hours, 7 days a week.</Empty>}
        </Section>
        {!isManagement(u) && (
          <Section title="Message the Omega team">
            <ActionForm action={startConversationAction} className="space-y-3">
              <div><label className="label" htmlFor="subject">Subject</label><input id="subject" name="subject" required maxLength={140} className="input" /></div>
              <div><label className="label" htmlFor="body">Message</label><textarea id="body" name="body" rows={5} required maxLength={4000} className="input" /></div>
              <Submit pendingText="Sending…">Send message</Submit>
            </ActionForm>
          </Section>
        )}
        {oversight.length > 0 && (
          <Section title="Oversight (audited)">
            <ul className="space-y-2 text-[14px]">{oversight.slice(0, 30).map((c) => <li key={c.id}><Link className="link" href={`/messages/${c.id}`}>{c.subject}</Link> <span className="text-[12px] text-muted">· {c.kind.replace("_", " ")}</span></li>)}</ul>
          </Section>
        )}
      </div>
    </>
  );
}

import { asc } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { saveArticleAction } from "../actions";

export const metadata = { title: "Help content" };
type Art = typeof s.faqArticles.$inferSelect;
function ArticleForm({ a }: { a?: Art }) {
  const k = a?.id ?? "new";
  return (
    <ActionForm action={saveArticleAction} className="grid gap-3 sm:grid-cols-4" resetOnSuccess={!a}>
      {a && <input type="hidden" name="id" value={a.id} />}
      <div className="sm:col-span-2"><label className="label" htmlFor={`t-${k}`}>Title</label><input id={`t-${k}`} name="title" defaultValue={a?.title} required className="input" /></div>
      <div><label className="label" htmlFor={`c-${k}`}>Category</label><input id={`c-${k}`} name="category" defaultValue={a?.category} className="input" /></div>
      <div><label className="label" htmlFor={`a-${k}`}>Audience</label><select id={`a-${k}`} name="audience" defaultValue={a?.audience ?? "public"} className="input"><option value="public">Public</option><option value="family">Families</option><option value="nanny">Nannies</option><option value="internal">Internal (SOP)</option></select></div>
      <div className="sm:col-span-4"><label className="label" htmlFor={`b-${k}`}>Body</label><textarea id={`b-${k}`} name="body" rows={a ? 4 : 6} defaultValue={a?.body} required className="input" /></div>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="published" defaultChecked={a?.published ?? true} className="accent-navy" />Published</label>
      <label className="flex items-center gap-2 text-[14px] sm:col-span-2"><input type="checkbox" name="aiApproved" defaultChecked={a?.aiApproved ?? false} className="accent-navy" />Approved AI knowledge source</label>
      <div className="text-right"><Submit className="btn-secondary btn-sm">{a ? "Save" : "Create article"}</Submit></div>
    </ActionForm>
  );
}
export default async function Content() {
  await requireUser({ perm: "content.manage" });
  const arts = await db.select().from(s.faqArticles).orderBy(asc(s.faqArticles.category), asc(s.faqArticles.title));
  const unanswered = await db.select().from(s.supportRequests).orderBy(asc(s.supportRequests.createdAt));
  const gaps = unanswered.filter((r) => r.category === "assistant_escalation").slice(-10);
  return (
    <>
      <PageHeader eyebrow="Knowledge" title="Help centre & FAQs" description="These articles power the help centre search and, where marked as approved, the assistant. The assistant never answers beyond them." />
      {gaps.length > 0 && <Section title="Questions the assistant couldn't answer" className="mb-6"><ul className="space-y-1 text-[14px]">{gaps.map((g) => <li key={g.id}>{g.body.slice(0, 160)}</li>)}</ul></Section>}
      <Section title="New article" className="mb-6"><ArticleForm /></Section>
      <div className="space-y-3">{arts.map((a) => <details key={a.id} className="card p-4"><summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2"><span className="font-medium text-navy">{a.title}</span><span className="flex gap-1.5"><Badge>{a.category}</Badge><Badge tone="info">{a.audience}</Badge>{a.aiApproved && <Badge tone="gold">AI source</Badge>}{!a.published && <Badge tone="warn">Draft</Badge>}</span></summary><div className="mt-4"><ArticleForm a={a} /></div></details>)}</div>
    </>
  );
}

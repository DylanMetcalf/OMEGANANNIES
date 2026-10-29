"use client";
import Link from "next/link";
import { useActionState } from "react";
import { askAction } from "@/app/help/actions";

export function AssistantBox() {
  const [st, act, pending] = useActionState(askAction, null);
  return (
    <div className="card p-5">
      <p className="eyebrow">Assistant · answers from our help articles only</p>
      <form action={act} className="mt-3 flex gap-2">
        <label htmlFor="ai-q" className="sr-only">Ask a question</label>
        <input id="ai-q" name="q" defaultValue={st?.q} placeholder="e.g. When is my booking confirmed?" className="input" maxLength={1000} />
        <button className="btn-primary" disabled={pending}>{pending ? "Thinking…" : "Ask"}</button>
      </form>
      <div aria-live="polite">
        {st?.error && <p className="mt-3 text-[14px] text-warn">{st.error}</p>}
        {st?.a && (
          <div className="mt-4 rounded-xl bg-cream p-4 text-[14px]">
            <p className="whitespace-pre-line">{st.a.text}</p>
            {st.a.sources.length > 0 && <p className="mt-2 text-[12px] text-muted">Sources: {st.a.sources.map((x, i) => <span key={x.slug}>{i > 0 && " · "}<a className="link" href={`#${x.slug}`}>{x.title}</a></span>)}</p>}
            {st.a.escalate && <p className="mt-2 text-[13px]">We&rsquo;ve passed your question to the team. <Link className="link" href="/messages">Message us</Link> for a personal answer.</p>}
            <p className="mt-2 text-[11px] text-muted">AI-generated from approved articles. It can&rsquo;t see your account, confirm bookings, quote prices or promise refunds.</p>
          </div>
        )}
      </div>
    </div>
  );
}

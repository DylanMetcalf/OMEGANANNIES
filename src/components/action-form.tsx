"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export type ActionResult = { ok?: string; error?: string; fieldErrors?: Record<string, string> } | null;
type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Progressive-enhancement form wrapper: inline success/error feedback, pending state, optional reset. */
export function ActionForm({ action, children, className, resetOnSuccess, confirm }: { action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; confirm?: string }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} noValidate={false}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      <div aria-live="polite" className="empty:hidden">
        {state?.error && <p role="alert" className="mt-3 rounded-lg bg-bad-50 px-3 py-2 text-[13px] text-bad">{state.error}</p>}
        {state?.ok && <p className="mt-3 rounded-lg bg-ok-50 px-3 py-2 text-[13px] text-ok">{state.ok}</p>}
      </div>
    </form>
  );
}

export function Submit({ children, className = "btn-primary", pendingText = "Saving…", name, value }: { children: ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" name={name} value={value} className={className} disabled={pending} aria-busy={pending}>{pending ? pendingText : children}</button>;
}

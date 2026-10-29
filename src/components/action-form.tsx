"use client";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "./toaster";

export type ActionResult = { ok?: string; error?: string; fieldErrors?: Record<string, string> } | null;
type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
const Pending = createContext(false);

/**
 * Form wrapper for server actions:
 * - With JavaScript, submits inside a transition so the user's input is kept when the server returns an error
 *   (React would otherwise reset uncontrolled fields after every action). The clicked button's name/value is included.
 * - Without JavaScript, the `action` attribute still posts the form (progressive enhancement).
 * - Results are announced in a polite live region; `resetOnSuccess` clears the form only after a success.
 */
export function ActionForm({ action, children, className, resetOnSuccess, confirm }: { action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; confirm?: string }) {
  // Toast from inside the action wrapper (not an effect) so it still shows when the form unmounts on success.
  const [state, formAction, isPending] = useActionState(async (prev: ActionResult, fd: FormData) => {
    const r = await action(prev, fd);
    if (r?.ok) toast(r.ok);
    return r;
  }, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return; // ignore double submits
    if (confirm && !window.confirm(confirm)) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  };
  return (
    <form ref={ref} action={formAction} onSubmit={onSubmit} className={className} aria-busy={isPending}>
      <Pending.Provider value={isPending}>{children}</Pending.Provider>
      <div aria-live="polite" className="empty:hidden">
        {state?.error && <p role="alert" className="mt-3 rounded-[10px] bg-bad-50 px-3 py-2 text-[13px] font-medium text-bad">{state.error}</p>}
        {state?.ok && /\s\/[a-z-]+\?token=/.test(state.ok) && <p className="mt-3 break-all rounded-[10px] bg-ok-50 px-3 py-2 text-[13px] font-medium text-ok">{state.ok}</p>}
      </div>
    </form>
  );
}

export function Submit({ children, className = "btn-primary", pendingText = "Saving…", name, value }: { children: ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending: nativePending } = useFormStatus();
  const pending = useContext(Pending) || nativePending;
  return <button type="submit" name={name} value={value} className={className} disabled={pending} aria-busy={pending}>{pending ? pendingText : children}</button>;
}

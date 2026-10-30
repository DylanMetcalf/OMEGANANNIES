"use client";
import { useFormStatus } from "react-dom";
/** Filter "Apply" button that shows the search is in flight (results stay visible meanwhile). */
export function FilterSubmit({ children = "Apply" }: { children?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button className="btn-primary" aria-busy={pending} disabled={pending}>{pending ? "Searching…" : children}</button>;
}

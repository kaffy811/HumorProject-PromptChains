"use client";
import { Fragment, startTransition, useActionState, useState } from "react";
import type { FormState } from "@/lib/actions";

// Submits by hand so a failed save keeps what was typed (form actions reset
// the form), and shows the action's error or success message under the fields.
export function ActionForm({ action, children, className = "form", submit, pendingLabel = "Saving…", danger, confirm, resetOnOk }: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children?: React.ReactNode; className?: string; submit: string; pendingLabel?: string; danger?: boolean; confirm?: string; resetOnOk?: boolean;
}) {
  const [state, run, pending] = useActionState(action, null);
  // A successful "add" remounts the fields (controlled ones included) empty.
  const [seen, setSeen] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (seen !== state) { setSeen(state); if (resetOnOk && state?.ok) setGeneration((g) => g + 1); }
  return (
    <form className={className} onSubmit={(e) => {
      e.preventDefault();
      if (confirm && !window.confirm(confirm)) return;
      const data = new FormData(e.currentTarget);
      startTransition(() => run(data));
    }}>
      <Fragment key={generation}>{children}</Fragment>
      {state?.error && <div className="notice notice-bad" role="alert">{state.error}</div>}
      {state?.ok && <div className="notice notice-good" role="status">{state.ok}</div>}
      <div><button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} type="submit" disabled={pending}>{pending ? pendingLabel : submit}</button></div>
    </form>
  );
}

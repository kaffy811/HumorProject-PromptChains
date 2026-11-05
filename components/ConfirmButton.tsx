"use client";
import { useFormStatus } from "react-dom";
export function ConfirmButton({ children, message, className = "btn btn-danger" }: { children: React.ReactNode; message: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}
      onClick={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>
      {pending ? "Working…" : children}
    </button>
  );
}

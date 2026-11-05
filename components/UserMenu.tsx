"use client";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

// Avatar button at the top right, like Humor Admin: who is signed in, theme,
// a link back to Humor Admin and sign out. Closes on outside click or Escape.
export function UserMenu({ name, email, avatarUrl, adminUrl }: { name: string; email: string | null; avatarUrl: string | null; adminUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <div className="user-menu" ref={root}>
      <button ref={button} type="button" className="avatar-button" aria-haspopup="true" aria-expanded={open} aria-controls="user-menu-panel" onClick={() => setOpen((o) => !o)} title={name}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
        {avatarUrl ? <img src={avatarUrl} alt="" className="avatar" /> : <span className="avatar" aria-hidden="true">{initial}</span>}
        <span className="sr-only">{`Account menu for ${name}`}</span>
      </button>
      {open && (
        <div id="user-menu-panel" className="menu-panel card" role="region" aria-label="Account">
          <div className="menu-who">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
            {avatarUrl ? <img src={avatarUrl} alt="" className="avatar avatar-lg" /> : <span className="avatar avatar-lg" aria-hidden="true">{initial}</span>}
            <span style={{ minWidth: 0, display: "grid", gap: 4, justifyItems: "start" }}>
              <b>{name}</b>
              {email && <span className="muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{email}</span>}
              <span className="badge badge-brand">Superadmin</span>
            </span>
          </div>
          <div className="menu-row"><span className="label">Theme</span><ThemeToggle /></div>
          {adminUrl && <a className="menu-link" href={adminUrl}>Open Humor Admin ↗</a>}
          <form action="/auth/signout" method="post"><button className="btn" type="submit" style={{ width: "100%" }}>Sign out</button></form>
        </div>
      )}
    </div>
  );
}

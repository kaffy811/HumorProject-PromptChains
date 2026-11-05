"use client";
import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";
const KEY = "theme";
const OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "system", label: "System", icon: "◐" },
];

// Applied before paint by THEME_SCRIPT in the root layout; this keeps it in sync.
export function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage blocked: system default */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the browser-only saved choice once after mount
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  const choose = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    try { if (next === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* not remembered */ }
  };
  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" aria-pressed={theme === o.value} onClick={() => choose(o.value)} title={`${o.label} theme`}>
          <span aria-hidden="true">{o.icon}</span>{o.label}
        </button>
      ))}
    </div>
  );
}

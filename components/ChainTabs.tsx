"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
// Edit · Run · Media for one chain.
export function ChainTabs({ id }: { id: string }) {
  const path = usePathname();
  const tabs = [{ href: `/chains/${id}`, label: "Edit steps" }, { href: `/chains/${id}/run`, label: "Generate" }, { href: `/chains/${id}/media`, label: "Media" }];
  return (
    <nav className="tabs" aria-label="Chain sections">
      {tabs.map((t) => <Link key={t.href} className="tab" href={t.href} aria-current={path === t.href || (t.label === "Media" && path.startsWith(`${t.href}/`)) ? "page" : undefined}>{t.label}</Link>)}
    </nav>
  );
}

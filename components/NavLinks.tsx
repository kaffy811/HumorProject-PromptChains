"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
// Top bar sections; chain and run pages belong to "Prompt chains".
export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="topbar-nav" aria-label="Sections">
      <Link className="nav-link" href="/" aria-current={path === "/" ? "page" : undefined}>Dashboard</Link>
      <Link className="nav-link" href="/chains" aria-current={path.startsWith("/chains") || path.startsWith("/runs") ? "page" : undefined}>Prompt chains</Link>
    </nav>
  );
}

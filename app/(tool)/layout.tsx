import Link from "next/link";
import { requireSuperadmin } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
export default async function ToolLayout({ children }: { children: React.ReactNode }) {
  const me = await requireSuperadmin();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">h.</span>
          <span>Prompt Chain Tool<small>Superadmin</small></span>
        </Link>
        <nav className="topbar-nav" aria-label="Sections">
          <Link className="nav-link" href="/">Prompt chains</Link>
        </nav>
        <div className="topbar-end">
          <ThemeToggle />
          <span className="who">{me.email ?? me.username ?? me.id}</span>
          <form action="/auth/signout" method="post"><button className="btn btn-sm" type="submit">Sign out</button></form>
        </div>
      </header>
      <main className="main">{children}</main>
    </>
  );
}

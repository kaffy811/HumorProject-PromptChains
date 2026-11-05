import type { Metadata } from "next";
import { ThemeToggle } from "@/components/ThemeToggle";
export const metadata: Metadata = { title: "Access denied" };
const COPY: Record<string, string> = {
  forbidden: "You're signed in, but this account is not a superadmin. Admins can use Humor Admin; the Prompt Chain Tool is for superadmins only.",
  "not-google": "Only Google sign-in is accepted here. Sign out and continue with Google.",
  unavailable: "Permissions could not be checked, so access is closed. Try again shortly.",
};
export default async function Denied({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason = "forbidden" } = await searchParams;
  return (
    <main className="login">
      <div className="login-theme"><ThemeToggle /></div>
      <div className="card login-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- static mascot */}
        <img className="login-mascot" src="/baby/pout.webp" alt="" />
        <span className="badge badge-bad" style={{ justifySelf: "center" }}>Superadmins only</span>
        <h1>Nice try, bestie.</h1>
        <p className="muted" style={{ margin: 0 }}>{COPY[reason] ?? COPY.forbidden}</p>
        <form action="/auth/signout" method="post">
          <button className="btn" type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}

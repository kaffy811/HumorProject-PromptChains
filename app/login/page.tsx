import type { Metadata } from "next";
import { GoogleButton } from "@/components/GoogleButton";
import { ThemeToggle } from "@/components/ThemeToggle";
export const metadata: Metadata = { title: "Sign in" };
const ERRORS: Record<string, string> = {
  session: "Google sign-in did not finish. Try again.",
  unavailable: "Sign-in is unavailable right now. Try again shortly.",
};
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="login">
      <div className="login-theme"><ThemeToggle /></div>
      <div className="card login-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- static mascot */}
        <img className="login-mascot" src="/baby/wink.webp" alt="" />
        <div className="brand" style={{ justifyContent: "center" }}>
          <span className="brand-mark">h.</span>
          <span style={{ textAlign: "left" }}>Prompt Chain Tool<small>The Humor Project</small></span>
        </div>
        <h1>Build the joke machine.</h1>
        <p className="muted" style={{ margin: 0 }}>Create, order and run the prompt chains that caption photos. Superadmins only.</p>
        {error && ERRORS[error] && <div className="notice notice-bad" role="alert">{ERRORS[error]}</div>}
        <GoogleButton next={next} />
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Every page and action checks <span className="mono">profiles.is_superadmin = true</span>.</p>
      </div>
    </main>
  );
}

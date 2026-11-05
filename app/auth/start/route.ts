import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/supabase/config";
import { safeNext } from "@/lib/gate";
export const dynamic = "force-dynamic";
const NEXT_COOKIE = "chains_next";

export async function GET(request: NextRequest) {
  const incoming = new URL(request.url);
  // PKCE cookies are host-only: start OAuth on the host Supabase will return to.
  const origin = process.env.CHAINS_AUTH_ORIGIN || incoming.origin;
  const target = safeNext(incoming.searchParams.get("next"));
  const response = NextResponse.redirect(new URL("/login?error=unavailable", origin));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (incoming.origin !== origin) {
    const start = new URL("/auth/start", origin);
    start.searchParams.set("next", target);
    response.headers.set("Location", start.toString());
    return response;
  }
  try {
    const { url, key } = config();
    const secure = incoming.protocol === "https:";
    const db = createServerClient(url, key, {
      cookieOptions: { secure, sameSite: "lax", path: "/" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    });
    const { data, error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback`, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
    if (error || !data.url) return response;
    response.cookies.set(NEXT_COOKIE, target, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 });
    response.headers.set("Location", data.url);
  } catch {
    console.error("Prompt Chain Tool sign-in start failed");
  }
  return response;
}

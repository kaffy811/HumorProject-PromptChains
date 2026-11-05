import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { config as supabaseConfig, secretKey } from "@/lib/supabase/config";
import { dataSchema } from "@/lib/supabase/schema";
import { gateDecision, isPublicPath } from "@/lib/gate";

// First wall: every non-public route needs a Google session whose profile has
// is_superadmin = true. Pages, actions and API routes re-check with requireSuperadmin().
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  let response = NextResponse.next({ request });
  const { url, key } = supabaseConfig();
  const db = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        const previous = response.cookies.getAll();
        response = NextResponse.next({ request });
        previous.forEach((cookie) => response.cookies.set(cookie));
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const finish = (result: NextResponse) => {
    response.cookies.getAll().forEach((cookie) => result.cookies.set(cookie));
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  };
  if (isPublicPath(path)) return finish(response);

  const deny = (target: string, status: number, message: string) => {
    if (path.startsWith("/api/"))
      return finish(NextResponse.json({ error: message }, { status }));
    const next = new URL(target, request.url);
    if (target === "/login" && path !== "/") next.searchParams.set("next", path + request.nextUrl.search);
    return finish(NextResponse.redirect(next));
  };
  try {
    const { data: { user } } = await db.auth.getUser();
    const { data: claims } = user ? await db.auth.getClaims() : { data: null };
    let profile = null;
    if (user) {
      const admin = createClient(url, secretKey(), {
        db: { schema: dataSchema() },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await admin.from("profiles").select("id,is_superadmin").eq("id", user.id).maybeSingle();
      if (error) return deny("/denied?reason=unavailable", 503, "Permissions could not be checked.");
      profile = data;
    }
    const result = gateDecision(user, claims?.claims, profile);
    if (result === "anonymous") return deny("/login", 401, "Sign in with Google.");
    if (result !== "allowed") return deny(`/denied?reason=${result}`, 403, "Superadmins only.");
  } catch {
    // Fail closed: a misconfigured deployment never serves chain data.
    return deny("/denied?reason=unavailable", 503, "Permissions could not be checked.");
  }
  return finish(response);
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|webp|gif|svg|ico)$).*)"],
};

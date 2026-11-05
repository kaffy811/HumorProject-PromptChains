import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { superadminOrNull } from "./auth";
import { RunError } from "./runs";

// Route handlers have no built-in CSRF check (Server Actions do): require the
// browser's Origin to be this site, then a superadmin session.
export async function guard(request: NextRequest) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("x-forwarded-host") ?? request.headers.get("host")))
    return { response: json({ error: "Cross-site request refused." }, 403) };
  const me = await superadminOrNull();
  if (!me) return { response: json({ error: "Superadmins only." }, 403) };
  return { me };
}
// The browser's Origin must name the host it sent the request to.
export function sameOrigin(origin: string | null, host: string | null) {
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function failure(error: unknown) {
  if (error instanceof RunError) return json({ error: error.message }, error.status);
  console.error("Prompt chain run failed", error instanceof Error ? error.message : "unknown");
  return json({ error: "Something went wrong. Try again." }, 500);
}

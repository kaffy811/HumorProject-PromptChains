import type { User } from "@supabase/supabase-js";
import { isGoogleSession } from "./google-session";

export type GateResult = "anonymous" | "not-google" | "forbidden" | "allowed";
type RoleFlags = { is_superadmin?: unknown } | null;

// The Prompt Chain Tool is for superadmins only: profiles.is_superadmin must be
// strictly TRUE. is_admin (Humor Admin's second role) is not enough, and null,
// missing or "true" strings never pass.
export function isSuperadmin(profile: RoleFlags) {
  return profile?.is_superadmin === true;
}

// Pure decision so the proxy, pages, actions and tests all agree.
export function gateDecision(
  user: Pick<User, "id" | "identities" | "is_anonymous"> | null,
  claims: unknown,
  profile: RoleFlags,
): GateResult {
  if (!user) return "anonymous";
  if (!isGoogleSession(user, claims)) return "not-google";
  return isSuperadmin(profile) ? "allowed" : "forbidden";
}

export const PUBLIC_PATHS = ["/login", "/denied"];
export function isPublicPath(path: string) {
  return PUBLIC_PATHS.includes(path) || path.startsWith("/auth/");
}

// Only same-site relative paths survive the OAuth round trip.
export function safeNext(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (isPublicPath(value.split("?")[0])) return "/";
  return value;
}

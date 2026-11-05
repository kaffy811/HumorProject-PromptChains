import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { serviceClient } from "./supabase/service";
import { gateDecision } from "./gate";

export type Superadmin = { id: string; email: string | null; username: string | null; name: string | null; avatarPath: string | null };
// "*" so a missing optional column never turns into a lockout.
const PROFILE = "*";
type Profile = { username: string | null; first_name: string | null; last_name: string | null; display_name: string | null; avatar_path: string | null } | null;
const describe = (profile: Profile) => ({
  username: profile?.username ?? null,
  name: profile?.display_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || null,
  avatarPath: profile?.avatar_path ?? null,
});

// Every page and every Server Action / route handler calls this. The proxy is
// the first wall; this is the second, because actions are reachable by direct POST.
export const requireSuperadmin = cache(async (): Promise<Superadmin> => {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: claims } = user ? await db.auth.getClaims() : { data: null };
  const { data: profile, error } = user
    ? await serviceClient().from("profiles").select(PROFILE).eq("id", user.id).maybeSingle()
    : { data: null, error: null };
  if (error) throw new Error("Permissions could not be checked.");
  const result = gateDecision(user, claims?.claims, profile);
  if (result === "anonymous") redirect("/login");
  if (result !== "allowed") redirect(`/denied?reason=${result}`);
  return { id: user!.id, email: user!.email ?? null, ...describe(profile) };
});

// For route handlers: same check, but answers with a status instead of a redirect.
export async function superadminOrNull(): Promise<Superadmin | null> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: claims } = await db.auth.getClaims();
  const { data: profile, error } = await serviceClient().from("profiles").select(PROFILE).eq("id", user.id).maybeSingle();
  if (error || gateDecision(user, claims?.claims, profile) !== "allowed") return null;
  return { id: user.id, email: user.email ?? null, ...describe(profile) };
}

import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- Schema is selected at deployment time. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, secretKey } from "./config";
import { dataSchema } from "./schema";
export type ServiceClient = SupabaseClient<any, any, any>;
// Bypasses RLS. Only reachable after requireSuperadmin() or the proxy gate.
// Writes pass the acting superadmin so the activity log credits them.
export function serviceClient(actorId?: string): ServiceClient {
  return createClient(config().url, secretKey(), {
    db: { schema: dataSchema() },
    auth: { persistSession: false, autoRefreshToken: false },
    global: actorId ? { headers: { "x-humor-admin": actorId } } : undefined,
  });
}

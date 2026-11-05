import "server-only";
import { isMissingTable } from "./data";
import { serviceClient, type ServiceClient } from "./supabase/service";

export type VersionRow = { id: string; version: number; label: string; snapshot: unknown; created_by: string | null; created_at: string; author: string | null };

// Saves the chain as it is now as the next version (no-op when unchanged).
// Best effort: an edit never fails because history could not be written, for
// example before migration 202611060002 is applied.
export async function saveVersion(db: ServiceClient, chainId: string, label: string, actor: string) {
  const { error } = await db.rpc("humor_save_prompt_chain_version", { chain: chainId, label, actor });
  if (error && !isMissingTable(error) && !/function .* does not exist|could not find the function/i.test(error.message))
    console.error("Could not save prompt chain version", error.message);
}

export async function listVersions(chainId: string): Promise<{ ready: boolean; versions: VersionRow[] }> {
  const db = serviceClient();
  const { data, error } = await db.from("humor_prompt_chain_versions")
    .select("id,version,label,snapshot,created_by,created_at").eq("chain_id", chainId).order("version", { ascending: false }).limit(200);
  if (error) {
    if (isMissingTable(error)) return { ready: false, versions: [] };
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Omit<VersionRow, "author">[];
  const ids = [...new Set(rows.map((r) => r.created_by).filter((id): id is string => !!id))];
  const authors = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await db.from("profiles").select("*").in("id", ids);
    for (const p of (people ?? []) as Record<string, unknown>[])
      authors.set(String(p.id), String(p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || "an admin"));
  }
  return { ready: true, versions: rows.map((r) => ({ ...r, author: r.created_by ? authors.get(r.created_by) ?? "an admin" : null })) };
}

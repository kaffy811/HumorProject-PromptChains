import "server-only";
import type { RuleStep } from "./chain-rules";
import { serviceClient, type ServiceClient } from "./supabase/service";
import { storageBucket } from "./supabase/schema";

export type ModelOption = { id: string; label: string; model_id: string; provider: string | null; providerName: string | null; is_active: boolean; supports_vision: boolean };
export type StepRow = RuleStep & {
  id: string; system_prompt: string; output_schema: unknown; llm_model_id: string | null;
  modelLabel: string | null;
};
export type ChainRow = { id: string; name: string; prompt_version: string; description: string | null; created_at: string; updated_at: string; share: number };

const STEP_COLUMNS = "id,position,name,llm_model_id,include_image,output_kind,system_prompt,user_prompt,output_schema,humor_llm_models(model_id,display_name,is_active,supports_vision,humor_llm_providers(slug,name))";
type RawStep = {
  id: string; position: number; name: string; llm_model_id: string | null; include_image: boolean; output_kind: string;
  system_prompt: string; user_prompt: string; output_schema: unknown;
  humor_llm_models: { model_id: string; display_name: string; is_active: boolean; supports_vision: boolean; humor_llm_providers: { slug: string; name: string } | null } | null;
};
const toStep = (s: RawStep): StepRow => ({
  id: s.id, position: s.position, name: s.name, llm_model_id: s.llm_model_id, include_image: s.include_image, output_kind: s.output_kind,
  system_prompt: s.system_prompt, user_prompt: s.user_prompt, output_schema: s.output_schema,
  model: s.humor_llm_models ? { model_id: s.humor_llm_models.model_id, is_active: s.humor_llm_models.is_active, supports_vision: s.humor_llm_models.supports_vision, provider: s.humor_llm_models.humor_llm_providers?.slug ?? null } : null,
  modelLabel: s.humor_llm_models ? `${s.humor_llm_models.display_name} · ${s.humor_llm_models.humor_llm_providers?.name ?? "no provider"}` : null,
});
const shareOf = (mix: unknown) => (Array.isArray(mix) ? (mix[0] as { share?: number } | undefined)?.share : (mix as { share?: number } | null)?.share) ?? 0;

// Missing table (migration not applied yet) → explain instead of crashing.
export function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  return !!error && (error.code === "42P01" || error.code === "42703" || error.code === "PGRST205" || error.code === "PGRST204" || /does not exist|could not find/i.test(error.message ?? ""));
}

export async function listChains() {
  const db = serviceClient();
  const { data, error } = await db.from("humor_prompt_chains")
    .select(`id,name,prompt_version,description,created_at,updated_at,humor_prompt_chain_mix(share),humor_prompt_chain_steps(${STEP_COLUMNS})`)
    .order("created_at", { ascending: false });
  if (error) return { error, chains: [] };
  const runs = await db.from("humor_chain_runs").select("chain_id,status").limit(5000);
  const counts = new Map<string, number>();
  for (const r of (runs.data ?? []) as { chain_id: string | null }[]) if (r.chain_id) counts.set(r.chain_id, (counts.get(r.chain_id) ?? 0) + 1);
  const chains = ((data ?? []) as unknown as (Omit<ChainRow, "share"> & { humor_prompt_chain_mix: unknown; humor_prompt_chain_steps: RawStep[] })[]).map((c) => ({
    id: c.id, name: c.name, prompt_version: c.prompt_version, description: c.description, created_at: c.created_at, updated_at: c.updated_at,
    share: shareOf(c.humor_prompt_chain_mix),
    steps: (c.humor_prompt_chain_steps ?? []).map(toStep).sort((a, b) => a.position - b.position),
    runs: counts.get(c.id) ?? 0,
  }));
  return { error: runs.error && !isMissingTable(runs.error) ? runs.error : null, chains, runsReady: !runs.error };
}

export async function getChain(id: string) {
  const db = serviceClient();
  const { data, error } = await db.from("humor_prompt_chains")
    .select(`id,name,prompt_version,description,created_at,updated_at,humor_prompt_chain_mix(share),humor_prompt_chain_steps(${STEP_COLUMNS})`)
    .eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const c = data as unknown as Omit<ChainRow, "share"> & { humor_prompt_chain_mix: unknown; humor_prompt_chain_steps: RawStep[] };
  return {
    chain: { id: c.id, name: c.name, prompt_version: c.prompt_version, description: c.description, created_at: c.created_at, updated_at: c.updated_at, share: shareOf(c.humor_prompt_chain_mix) } as ChainRow,
    steps: (c.humor_prompt_chain_steps ?? []).map(toStep).sort((a, b) => a.position - b.position),
  };
}

export async function modelOptions(): Promise<ModelOption[]> {
  const { data } = await serviceClient().from("humor_llm_models")
    .select("id,model_id,display_name,is_active,supports_vision,humor_llm_providers(slug,name)").order("display_name");
  return ((data ?? []) as unknown as { id: string; model_id: string; display_name: string; is_active: boolean; supports_vision: boolean; humor_llm_providers: { slug: string; name: string } | null }[]).map((m) => ({
    id: m.id, model_id: m.model_id, is_active: m.is_active, supports_vision: m.supports_vision,
    provider: m.humor_llm_providers?.slug ?? null, providerName: m.humor_llm_providers?.name ?? null,
    label: `${m.display_name} · ${m.humor_llm_providers?.name ?? "no provider"}${m.is_active ? "" : " (inactive)"}`,
  }));
}

// Private buckets: short-lived signed URLs, generated per request.
export async function signedUrls(db: ServiceClient, bucket: string, paths: (string | null | undefined)[], seconds = 600) {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const result: Record<string, string> = {};
  if (!unique.length) return result;
  const { data } = await db.storage.from(storageBucket(bucket)).createSignedUrls(unique, seconds);
  for (const item of data ?? []) if (item.path && item.signedUrl) result[item.path] = item.signedUrl;
  return result;
}

// Dashboard: chains, recent runs with thumbnails, and run steps for the stats.
export async function dashboardData() {
  const db = serviceClient();
  const listed = await listChains();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [runs, recent] = await Promise.all([
    db.from("humor_chain_runs").select("id,status,created_at,completed_at").gte("created_at", since).limit(5000),
    db.from("humor_chain_runs").select("id,chain_id,chain_name,image_path,status,captions,created_at").order("created_at", { ascending: false }).limit(8),
  ]);
  const runRows = (runs.data ?? []) as { id: string; status: string; created_at: string; completed_at: string | null }[];
  const ids = runRows.map((r) => r.id);
  const steps: { run_id: string; usage: unknown; latency_ms: number | null }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("humor_chain_run_steps").select("run_id,usage,latency_ms").in("run_id", ids.slice(i, i + 200));
    steps.push(...((data ?? []) as typeof steps));
  }
  const recentRows = (recent.data ?? []) as { id: string; chain_id: string | null; chain_name: string; image_path: string; status: string; captions: unknown; created_at: string }[];
  const thumbs = await signedUrls(db, "humor-chain-runs", recentRows.map((r) => r.image_path));
  return { ...listed, runs: runRows, steps, recent: recentRows, thumbs, runsReady: listed.runsReady && !runs.error };
}

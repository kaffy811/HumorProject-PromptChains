"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperadmin } from "./auth";
import { MAX_STEPS, parseChain, parseStep, UUID } from "./chain-rules";
import { serviceClient } from "./supabase/service";

export type FormState = { error?: string; ok?: string } | null;
const dbMessage = (error: { code?: string; message: string }) =>
  error.code === "23505" ? "A chain with that prompt version already exists." : error.message;
const refresh = (chainId?: string) => {
  revalidatePath("/");
  revalidatePath("/chains");
  if (chainId) revalidatePath(`/chains/${chainId}`, "layout");
};

export async function createChain(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const parsed = parseChain(form);
  if (!parsed.ok) return { error: parsed.error };
  const { data, error } = await serviceClient(me.id).from("humor_prompt_chains").insert(parsed.value).select("id").single();
  if (error) return { error: dbMessage(error) };
  refresh();
  redirect(`/chains/${data.id}?created=1`);
}

export async function updateChain(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Unknown prompt chain." };
  const parsed = parseChain(form);
  if (!parsed.ok) return { error: parsed.error };
  const { data, error } = await serviceClient(me.id).from("humor_prompt_chains").update(parsed.value).eq("id", id).select("id").maybeSingle();
  if (error) return { error: dbMessage(error) };
  if (!data) return { error: "This prompt chain no longer exists." };
  refresh(id);
  return { ok: "Saved." };
}

// The chain members are using (Humor Admin → Model for members) cannot be deleted.
// Its runs stay, keeping the chain's name and version.
export async function deleteChain(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Unknown prompt chain." };
  const db = serviceClient(me.id);
  const { data: mix } = await db.from("humor_prompt_chain_mix").select("share").eq("chain_id", id).maybeSingle();
  if (mix?.share) return { error: "Members are using this chain. Choose another model for members in Humor Admin first." };
  const { error } = await db.from("humor_prompt_chains").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect("/chains?deleted=1");
}

export async function createStep(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const chainId = String(form.get("chain_id") ?? "");
  if (!UUID.test(chainId)) return { error: "Unknown prompt chain." };
  const parsed = parseStep(form);
  if (!parsed.ok) return { error: parsed.error };
  const db = serviceClient(me.id);
  const { data: existing, error: read } = await db.from("humor_prompt_chain_steps").select("position").eq("chain_id", chainId);
  if (read) return { error: read.message };
  if ((existing ?? []).length >= MAX_STEPS) return { error: `A chain can have at most ${MAX_STEPS} steps.` };
  const position = Math.max(0, ...(existing ?? []).map((s) => s.position as number)) + 1;
  const { error } = await db.from("humor_prompt_chain_steps").insert({ ...parsed.value, chain_id: chainId, position });
  if (error) return { error: error.code === "23503" ? "This prompt chain no longer exists." : error.message };
  refresh(chainId);
  return { ok: `Step ${position} added.` };
}

export async function updateStep(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const chainId = String(form.get("chain_id") ?? ""), id = String(form.get("id") ?? "");
  if (!UUID.test(chainId) || !UUID.test(id)) return { error: "Unknown step." };
  const parsed = parseStep(form);
  if (!parsed.ok) return { error: parsed.error };
  const { data, error } = await serviceClient(me.id).from("humor_prompt_chain_steps").update(parsed.value).eq("id", id).eq("chain_id", chainId).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "This step no longer exists." };
  refresh(chainId);
  return { ok: "Step saved." };
}

// Deleting closes the gap: the remaining steps are renumbered 1..n.
export async function deleteStep(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const chainId = String(form.get("chain_id") ?? ""), id = String(form.get("id") ?? "");
  if (!UUID.test(chainId) || !UUID.test(id)) return { error: "Unknown step." };
  const db = serviceClient(me.id);
  const { error } = await db.from("humor_prompt_chain_steps").delete().eq("id", id).eq("chain_id", chainId);
  if (error) return { error: error.message };
  const { data: rest } = await db.from("humor_prompt_chain_steps").select("id").eq("chain_id", chainId).order("position");
  if (rest?.length) await db.rpc("humor_reorder_prompt_chain_steps", { chain: chainId, step_ids: rest.map((s) => s.id) });
  refresh(chainId);
  return { ok: "Step deleted." };
}

// Called with the complete new order (ids top to bottom); the database applies it atomically.
export async function reorderSteps(chainId: string, stepIds: string[]): Promise<FormState> {
  const me = await requireSuperadmin();
  if (!UUID.test(chainId) || !Array.isArray(stepIds) || stepIds.length > MAX_STEPS || !stepIds.every((id) => typeof id === "string" && UUID.test(id)))
    return { error: "Invalid order." };
  const { error } = await serviceClient(me.id).rpc("humor_reorder_prompt_chain_steps", { chain: chainId, step_ids: stepIds });
  if (error) return { error: /exactly once/.test(error.message) ? "The steps changed in another tab. Reload and try again." : error.message };
  refresh(chainId);
  return { ok: "Order saved." };
}

"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperadmin } from "./auth";
import { MAX_STEPS, parseChain, parseStep, UUID } from "./chain-rules";
import { saveVersion } from "./versions";
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
  await saveVersion(serviceClient(me.id), data.id, "Created", me.id);
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
  await saveVersion(serviceClient(me.id), id, "Edited chain details", me.id);
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
  await saveVersion(db, chainId, `Added step ${position} (${parsed.value.name})`, me.id);
  refresh(chainId);
  return { ok: `Step ${position} added.` };
}

export async function updateStep(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const chainId = String(form.get("chain_id") ?? ""), id = String(form.get("id") ?? "");
  if (!UUID.test(chainId) || !UUID.test(id)) return { error: "Unknown step." };
  const parsed = parseStep(form);
  if (!parsed.ok) return { error: parsed.error };
  const db = serviceClient(me.id);
  const { data, error } = await db.from("humor_prompt_chain_steps").update(parsed.value).eq("id", id).eq("chain_id", chainId).select("id,position").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "This step no longer exists." };
  await saveVersion(db, chainId, `Edited step ${data.position} (${parsed.value.name})`, me.id);
  refresh(chainId);
  return { ok: "Step saved." };
}

// Deleting closes the gap: the remaining steps are renumbered 1..n.
export async function deleteStep(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const chainId = String(form.get("chain_id") ?? ""), id = String(form.get("id") ?? "");
  if (!UUID.test(chainId) || !UUID.test(id)) return { error: "Unknown step." };
  const db = serviceClient(me.id);
  const { data: gone, error } = await db.from("humor_prompt_chain_steps").delete().eq("id", id).eq("chain_id", chainId).select("position,name").maybeSingle();
  if (error) return { error: error.message };
  const { data: rest } = await db.from("humor_prompt_chain_steps").select("id").eq("chain_id", chainId).order("position");
  if (rest?.length) await db.rpc("humor_reorder_prompt_chain_steps", { chain: chainId, step_ids: rest.map((s) => s.id) });
  if (gone) await saveVersion(db, chainId, `Deleted step ${gone.position} (${gone.name})`, me.id);
  refresh(chainId);
  return { ok: "Step deleted." };
}

// Called with the complete new order (ids top to bottom); the database applies it atomically.
export async function reorderSteps(chainId: string, stepIds: string[]): Promise<FormState> {
  const me = await requireSuperadmin();
  if (!UUID.test(chainId) || !Array.isArray(stepIds) || stepIds.length > MAX_STEPS || !stepIds.every((id) => typeof id === "string" && UUID.test(id)))
    return { error: "Invalid order." };
  const db = serviceClient(me.id);
  const { error } = await db.rpc("humor_reorder_prompt_chain_steps", { chain: chainId, step_ids: stepIds });
  if (error) return { error: /exactly once/.test(error.message) ? "The steps changed in another tab. Reload and try again." : error.message };
  await saveVersion(db, chainId, "Reordered steps", me.id);
  refresh(chainId);
  return { ok: "Order saved." };
}

// "Model for every step": one statement, so the chain never runs half on one
// provider and half on another. Steps that see the photo need a vision model.
export async function setChainModel(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const chainId = String(form.get("chain_id") ?? ""), modelId = String(form.get("llm_model_id") ?? "");
  if (!UUID.test(chainId)) return { error: "Unknown prompt chain." };
  if (!UUID.test(modelId)) return { error: "Choose a model." };
  const db = serviceClient(me.id);
  const [{ data: model }, { data: steps, error: read }] = await Promise.all([
    db.from("humor_llm_models").select("display_name,is_active,supports_vision,humor_llm_providers(slug,name)").eq("id", modelId).maybeSingle(),
    db.from("humor_prompt_chain_steps").select("position,include_image,llm_model_id").eq("chain_id", chainId).order("position"),
  ]);
  if (read) return { error: read.message };
  if (!model) return { error: "That model no longer exists." };
  if (!steps?.length) return { error: "This chain has no steps yet." };
  if (!model.is_active) return { error: `${model.display_name} is inactive. Activate it in Humor Admin → LLM models first.` };
  const seeing = steps.filter((s) => s.include_image).map((s) => s.position);
  if (seeing.length && !model.supports_vision) return { error: `${model.display_name} does not accept images, but step ${seeing.join(", ")} sees the photo.` };
  if (steps.every((s) => s.llm_model_id === modelId)) return { ok: `Every step already uses ${model.display_name}.` };
  const { error } = await db.from("humor_prompt_chain_steps").update({ llm_model_id: modelId }).eq("chain_id", chainId);
  if (error) return { error: error.message };
  await saveVersion(db, chainId, `Every step on ${model.display_name}`, me.id);
  refresh(chainId);
  return { ok: `All ${steps.length} steps now use ${model.display_name}.` };
}

// Copy a chain and its steps under a new prompt version (not given to members).
export async function duplicateChain(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Unknown prompt chain." };
  const parsed = parseChain(form);
  if (!parsed.ok) return { error: parsed.error };
  const { data, error } = await serviceClient(me.id).rpc("humor_duplicate_prompt_chain", { source: id, new_version: parsed.value.prompt_version, new_name: parsed.value.name, actor: me.id });
  if (error) return { error: /duplicate key|unique/i.test(error.message) ? "A chain with that prompt version already exists." : /does not exist|could not find the function/i.test(error.message) ? "Run migration 202611060002_prompt_chain_versions.sql first." : error.message };
  refresh();
  redirect(`/chains/${data as string}?copied=1`);
}

// Puts the chain back to an earlier version (the current state is kept as a version first).
export async function restoreVersion(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const chainId = String(form.get("chain_id") ?? ""), versionId = String(form.get("version_id") ?? "");
  if (!UUID.test(chainId) || !UUID.test(versionId)) return { error: "Unknown version." };
  const db = serviceClient(me.id);
  const { data: version } = await db.from("humor_prompt_chain_versions").select("version").eq("id", versionId).eq("chain_id", chainId).maybeSingle();
  if (!version) return { error: "That version no longer exists." };
  const { data, error } = await db.rpc("humor_restore_prompt_chain_version", { version_id: versionId, actor: me.id });
  if (error) return { error: error.message };
  refresh(chainId);
  return { ok: `Restored version ${version.version}; saved as version ${data}.` };
}


"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperadmin } from "./auth";
import { chainModelOf, MAX_STEPS, parseChain, parseStep, simpleStep, stepKind, UUID } from "./chain-rules";
import { saveVersion } from "./versions";
import { serviceClient } from "./supabase/service";

// id: the record a create made (the canvas selects a new step).
export type FormState = { error?: string; ok?: string; id?: string } | null;
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
  const db = serviceClient(me.id);
  let result = await db.from("humor_prompt_chains").insert(parsed.value).select("id").single();
  // Before migration 202611070001 the chain has no model column; steps still get it.
  if (result.error && missingColumn(result.error)) {
    const { name, prompt_version, description } = parsed.value;
    result = await db.from("humor_prompt_chains").insert({ name, prompt_version, description }).select("id").single();
  }
  if (result.error) return { error: dbMessage(result.error) };
  await saveVersion(db, result.data.id, "Created", me.id);
  refresh();
  redirect(`/chains/${result.data.id}?created=1`);
}

// Chain settings: details plus the chain's model, which every step then uses.
export async function updateChain(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Unknown prompt chain." };
  const parsed = parseChain(form);
  if (!parsed.ok) return { error: parsed.error };
  const { llm_model_id: modelId, ...details } = parsed.value;
  const db = serviceClient(me.id);
  let switched: string | null = null;
  if (modelId) {
    const applied = await applyChainModel(db, id, modelId);
    if ("error" in applied) return { error: applied.error };
    switched = applied.switched;
  }
  const { data, error } = await db.from("humor_prompt_chains").update(details).eq("id", id).select("id").maybeSingle();
  if (error) return { error: dbMessage(error) };
  if (!data) return { error: "This prompt chain no longer exists." };
  await saveVersion(db, id, switched ? `Every step on ${switched}` : "Edited chain settings", me.id);
  refresh(id);
  return { ok: switched ? `Saved. Every step now uses ${switched}.` : "Saved." };
}

type Db = ReturnType<typeof serviceClient>;
const missingColumn = (error: { code?: string; message?: string }) => error.code === "PGRST204" || error.code === "42703" || /llm_model_id/.test(error.message ?? "") && /column|schema cache/i.test(error.message ?? "");

// Sets the chain's model and puts every step on it (one statement for the
// steps, so a chain never runs half on one provider). Steps that see the
// photo need a model that accepts images. switched = the model's name when
// anything changed.
async function applyChainModel(db: Db, chainId: string, modelId: string): Promise<{ error: string } | { switched: string | null }> {
  const [{ data: model }, { data: steps, error: read }, { data: chain }] = await Promise.all([
    db.from("humor_llm_models").select("display_name,is_active,supports_vision").eq("id", modelId).maybeSingle(),
    db.from("humor_prompt_chain_steps").select("position,include_image,llm_model_id").eq("chain_id", chainId).order("position"),
    db.from("humor_prompt_chains").select("*").eq("id", chainId).maybeSingle(),
  ]);
  if (read) return { error: read.message };
  if (!chain) return { error: "This prompt chain no longer exists." };
  if (!model) return { error: "That model no longer exists." };
  const list = steps ?? [];
  const same = list.every((s) => s.llm_model_id === modelId) && (chain as { llm_model_id?: string | null }).llm_model_id === modelId;
  if (same) return { switched: null };
  if (!model.is_active) return { error: `${model.display_name} is inactive. Activate it in Humor Admin → LLM models first.` };
  const seeing = list.filter((s) => s.include_image).map((s) => s.position);
  if (seeing.length && !model.supports_vision) return { error: `${model.display_name} does not accept images, but step ${seeing.join(", ")} sees the photo.` };
  if (list.length) {
    const { error } = await db.from("humor_prompt_chain_steps").update({ llm_model_id: modelId }).eq("chain_id", chainId);
    if (error) return { error: error.message };
  }
  const { error } = await db.from("humor_prompt_chains").update({ llm_model_id: modelId }).eq("id", chainId);
  if (error && !missingColumn(error)) return { error: error.message };
  return { switched: model.display_name };
}

// Simple steps: after any change to a chain's steps, each step's inputs are
// regenerated for its position (member input + every earlier step's output)
// and the last step returns the captions. Hand-written user prompts (restored
// older versions) have their instructions moved into the Prompt first.
async function syncInputs(db: Db, chainId: string) {
  const { data } = await db.from("humor_prompt_chain_steps").select("id,position,name,system_prompt,user_prompt,output_kind").eq("chain_id", chainId).order("position");
  const steps = (data ?? []) as { id: string; position: number; name: string; system_prompt: string; user_prompt: string; output_kind: string }[];
  const names = steps.map((s) => s.name);
  for (const [i, step] of steps.entries()) {
    const next = { ...simpleStep(step, i + 1, names), output_kind: stepKind(i + 1, steps.length) };
    if (next.system_prompt === step.system_prompt && next.user_prompt === step.user_prompt && next.output_kind === step.output_kind) continue;
    await db.from("humor_prompt_chain_steps").update(next).eq("id", step.id);
  }
}

// New steps use the chain's model (its setting, else the one its steps use).
async function chainModel(db: Db, chainId: string) {
  const [{ data: chain }, { data: steps }] = await Promise.all([
    db.from("humor_prompt_chains").select("*").eq("id", chainId).maybeSingle(),
    db.from("humor_prompt_chain_steps").select("position,llm_model_id").eq("chain_id", chainId),
  ]);
  return chainModelOf((chain as { llm_model_id?: string | null } | null)?.llm_model_id ?? null, (steps ?? []) as { position: number; llm_model_id: string | null }[]).id;
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
  const { data: existing, error: read } = await db.from("humor_prompt_chain_steps").select("id,position").eq("chain_id", chainId).order("position");
  if (read) return { error: read.message };
  const list = (existing ?? []) as { id: string; position: number }[];
  if (list.length >= MAX_STEPS) return { error: `A chain can have at most ${MAX_STEPS} steps.` };
  // Added at the end, then moved into place when inserted between steps (canvas "+").
  const at = Number(form.get("insert_at") || list.length + 1);
  const target = Number.isInteger(at) && at >= 1 && at <= list.length ? at : list.length + 1;
  const position = Math.max(0, ...list.map((s) => s.position)) + 1;
  const { data: created, error } = await db.from("humor_prompt_chain_steps")
    .insert({ ...parsed.value, llm_model_id: await chainModel(db, chainId), chain_id: chainId, position }).select("id").single();
  if (error) return { error: error.code === "23503" ? "This prompt chain no longer exists." : error.message };
  const ids = list.map((s) => s.id);
  ids.splice(target - 1, 0, created.id);
  const { error: moved } = await db.rpc("humor_reorder_prompt_chain_steps", { chain: chainId, step_ids: ids });
  if (moved) return { error: `Step added, but it could not be moved into place: ${moved.message}` };
  await syncInputs(db, chainId);
  await saveVersion(db, chainId, `Added step ${target} (${parsed.value.name})`, me.id);
  refresh(chainId);
  return { ok: `Step ${target} added.`, id: created.id };
}

export async function updateStep(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireSuperadmin();
  const chainId = String(form.get("chain_id") ?? ""), id = String(form.get("id") ?? "");
  if (!UUID.test(chainId) || !UUID.test(id)) return { error: "Unknown step." };
  const parsed = parseStep(form);
  if (!parsed.ok) return { error: parsed.error };
  const db = serviceClient(me.id);
  // The model is the chain's (Chain settings), never set per step.
  // Inputs (user prompt) and output kind are generated by syncInputs, which first moves any
  // hand-written instructions into the Prompt; the form never overwrites them.
  const { name, include_image, system_prompt, output_schema } = parsed.value;
  const { data, error } = await db.from("humor_prompt_chain_steps").update({ name, include_image, system_prompt, output_schema }).eq("id", id).eq("chain_id", chainId).select("id,position").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "This step no longer exists." };
  await syncInputs(db, chainId);
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
  await syncInputs(db, chainId);
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
  await syncInputs(db, chainId);
  await saveVersion(db, chainId, "Reordered steps", me.id);
  refresh(chainId);
  return { ok: "Order saved." };
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
  // An older version may predate simple steps: convert it, and keep that as a version too.
  await syncInputs(db, chainId);
  await saveVersion(db, chainId, `Restored version ${version.version} (inputs regenerated)`, me.id);
  refresh(chainId);
  return { ok: `Restored version ${version.version}; saved as version ${data}.` };
}


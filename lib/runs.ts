import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { chainProblems, fillPrompt, UUID, withModelOverride } from "./chain-rules";
import { getChain, modelOptions } from "./data";
import { callStep, parseCaptions, SUPPORTED_PROVIDERS } from "./llm";
import { serviceClient } from "./supabase/service";
import { storageBucket } from "./supabase/schema";

export const RUN_BUCKET = "humor-chain-runs";
export const MAX_UPLOAD_BYTES = 4_000_000;
export class RunError extends Error { constructor(message: string, public status = 400) { super(message); } }

export function sniffImage(bytes: Uint8Array) {
  const head = Buffer.from(bytes.subarray(0, 12));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(head.toString("ascii", 0, 6))) return "image/gif";
  return null;
}

// Long side 1024 px JPEG: small enough for every provider, big enough to read.
export async function prepareImage(bytes: Uint8Array) {
  try {
    return await sharp(bytes, { animated: false, limitInputPixels: 40_000_000 }).rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    throw new RunError("That image could not be read.");
  }
}

// The photo of an existing member post, by caption id.
async function postImage(captionId: string) {
  const db = serviceClient();
  const { data } = await db.from("humor_captions").select("id,deleted_at,humor_images!inner(storage_path)").eq("id", captionId).maybeSingle();
  const path = (data?.humor_images as unknown as { storage_path: string | null } | undefined)?.storage_path;
  if (!data || data.deleted_at || !path) throw new RunError("That post is not available.");
  const { data: file, error } = await db.storage.from(storageBucket("humor-images")).download(path);
  if (error || !file) throw new RunError("That post's photo could not be loaded.", 502);
  return new Uint8Array(await file.arrayBuffer());
}

// Creates the run: stores the photo and copies every step's current settings.
export async function startRun(userId: string, input: { chainId: string; direction: string; upload: File | null; captionId: string | null; modelOverride?: string | null }) {
  if (!UUID.test(input.chainId)) throw new RunError("Unknown prompt chain.");
  const direction = input.direction.trim();
  if ([...direction].length > 120) throw new RunError("Keep the direction under 120 characters.");
  const found = await getChain(input.chainId);
  if (!found) throw new RunError("This prompt chain no longer exists.", 404);
  const { chain } = found;
  // Optional: every step of this run uses one model (e.g. compare Gemini vs GPT).
  let override = null;
  if (input.modelOverride) {
    if (!UUID.test(input.modelOverride)) throw new RunError("Unknown model.");
    override = (await modelOptions()).find((m) => m.id === input.modelOverride) ?? null;
    if (!override) throw new RunError("That model no longer exists.");
  }
  const steps = withModelOverride(found.steps, override);
  const blocking = chainProblems(steps, SUPPORTED_PROVIDERS).filter((p) => p.blocking);
  if (blocking.length) throw new RunError(`${override ? `${override.label} cannot run this chain` : "Fix the chain first"}: ${blocking.map((p) => (p.position ? `step ${p.position}: ` : "") + p.message).join(" ")}`);

  let raw: Uint8Array;
  if (input.captionId) {
    if (!UUID.test(input.captionId)) throw new RunError("Unknown post.");
    raw = await postImage(input.captionId);
  } else {
    if (!input.upload || !input.upload.size) throw new RunError("Choose a photo or a post.");
    if (input.upload.size > MAX_UPLOAD_BYTES) throw new RunError("Photos must be 4 MB or smaller.");
    raw = new Uint8Array(await input.upload.arrayBuffer());
    if (!sniffImage(raw)) throw new RunError("Choose a JPG, PNG, WebP or GIF.");
  }
  const image = await prepareImage(raw);

  const db = serviceClient(userId);
  const runId = randomUUID();
  const imagePath = `${runId}.jpg`;
  const { error: upload } = await db.storage.from(storageBucket(RUN_BUCKET)).upload(imagePath, image, { contentType: "image/jpeg", upsert: false });
  if (upload) throw new RunError(`The photo could not be stored: ${upload.message}`, 502);
  const { error: run } = await db.from("humor_chain_runs").insert({
    id: runId, chain_id: chain.id, chain_name: chain.name, prompt_version: chain.prompt_version, image_path: imagePath,
    source_caption_id: input.captionId, direction: direction || null, step_count: steps.length, created_by: userId,
  });
  if (run) { await db.storage.from(storageBucket(RUN_BUCKET)).remove([imagePath]); throw new RunError(run.message, 500); }
  const { data: models } = await db.from("humor_llm_models").select("id,model_id,max_output_tokens,temperature,humor_llm_providers(slug)").in("id", steps.map((s) => s.llm_model_id).filter(Boolean));
  const byId = new Map(((models ?? []) as unknown as { id: string; model_id: string; max_output_tokens: number | null; temperature: number | null; humor_llm_providers: { slug: string } | null }[]).map((m) => [m.id, m]));
  const { error: copied } = await db.from("humor_chain_run_steps").insert(steps.map((s, i) => {
    const m = byId.get(s.llm_model_id!)!;
    return {
      run_id: runId, position: i + 1, step_id: s.id, name: s.name, provider: m.humor_llm_providers?.slug ?? "", model: m.model_id,
      system_prompt: s.system_prompt, user_prompt_template: s.user_prompt, include_image: s.include_image, output_kind: s.output_kind,
      output_schema: s.output_schema ?? null, max_output_tokens: m.max_output_tokens, temperature: m.temperature,
    };
  }));
  if (copied) { await db.from("humor_chain_runs").delete().eq("id", runId); await db.storage.from(storageBucket(RUN_BUCKET)).remove([imagePath]); throw new RunError(copied.message, 500); }
  return { runId, steps: steps.map((s, i) => ({ position: i + 1, name: s.name, model: s.modelLabel })) };
}

type RunStepRow = {
  position: number; name: string; provider: string; model: string; system_prompt: string; user_prompt_template: string;
  include_image: boolean; output_kind: string; output_schema: object | null; max_output_tokens: number | null; temperature: number | string | null;
  status: string; output: string | null;
};

// Runs one step: earlier steps must be complete; a failed step may be retried.
export async function runStep(userId: string, runId: string, position: number, env: Record<string, string | undefined> = process.env) {
  if (!UUID.test(runId) || !Number.isInteger(position) || position < 1 || position > 20) throw new RunError("Unknown step.");
  const db = serviceClient(userId);
  const [{ data: run }, { data: rows }] = await Promise.all([
    db.from("humor_chain_runs").select("id,image_path,direction,status,step_count").eq("id", runId).maybeSingle(),
    db.from("humor_chain_run_steps").select("*").eq("run_id", runId).order("position"),
  ]);
  if (!run) throw new RunError("This run no longer exists.", 404);
  const steps = (rows ?? []) as RunStepRow[];
  const step = steps.find((s) => s.position === position);
  if (!step) throw new RunError("Unknown step.");
  if (step.status === "completed") return { status: "completed" as const, output: step.output };
  if (steps.some((s) => s.position < position && s.status !== "completed")) throw new RunError("Run the earlier steps first.", 409);

  const outputs = steps.filter((s) => s.position < position).map((s) => s.output);
  const userPrompt = fillPrompt(step.user_prompt_template, run.direction ?? "", outputs);
  let image: { base64: string; mime: string } | null = null;
  if (step.include_image) {
    const { data: file, error } = await db.storage.from(storageBucket(RUN_BUCKET)).download(run.image_path);
    if (error || !file) throw new RunError("The run's photo could not be loaded.", 502);
    image = { base64: Buffer.from(await file.arrayBuffer()).toString("base64"), mime: "image/jpeg" };
  }
  if (run.status !== "running") await db.from("humor_chain_runs").update({ status: "running", completed_at: null }).eq("id", runId);

  const started = Date.now();
  const temperature = step.temperature === null ? null : Number(step.temperature);
  const result = await callStep({
    provider: step.provider, model: step.model, systemPrompt: step.system_prompt, userPrompt, image,
    json: step.output_kind === "captions", schema: step.output_schema, maxOutputTokens: step.max_output_tokens,
    temperature: Number.isFinite(temperature) ? temperature : null,
  }, env);
  const latency = Date.now() - started;
  const isLast = position === run.step_count;
  let captions = null, error = result.ok ? null : result.error;
  if (result.ok && step.output_kind === "captions") {
    const parsed = parseCaptions(result.text);
    if (parsed.ok) captions = parsed.captions; else error = parsed.error;
  }
  const now = new Date().toISOString();
  await db.from("humor_chain_run_steps").update({
    status: error ? "failed" : "completed", user_prompt: userPrompt, output: result.ok ? result.text : null,
    error, usage: result.usage, latency_ms: latency, completed_at: now,
  }).eq("run_id", runId).eq("position", position);
  if (error) {
    await db.from("humor_chain_runs").update({ status: "failed", completed_at: now }).eq("id", runId);
    return { status: "failed" as const, error, output: result.ok ? result.text : null, latencyMs: latency, usage: result.usage };
  }
  if (isLast) await db.from("humor_chain_runs").update({ status: "completed", completed_at: now, captions, final_output: result.ok ? result.text : null }).eq("id", runId);
  return { status: "completed" as const, output: result.ok ? result.text : null, captions, latencyMs: latency, usage: result.usage, done: isLast };
}

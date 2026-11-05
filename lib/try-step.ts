import "server-only";
import { fillPrompt, parseStep, placeholdersIn, UUID } from "./chain-rules";
import { modelOptions } from "./data";
import { callStep, parseCaptions, SUPPORTED_PROVIDERS, type Caption, type Usage } from "./llm";
import { MAX_UPLOAD_BYTES, prepareImage, RUN_BUCKET, RunError, sniffImage } from "./runs";
import { serviceClient } from "./supabase/service";
import { storageBucket } from "./supabase/schema";

export type TryResult = {
  ok: boolean; error?: string; prompt: string; output: string | null; captions: Caption[] | null;
  usage: Usage; latencyMs: number; model: string;
};
const MAX_SAMPLE = 20_000;

// "Test this step": runs one step as it is in the form (saved or not) with
// hand-written inputs for {previous} / {stepN}. One model call; nothing is saved.
export async function tryStep(form: FormData, env: Record<string, string | undefined> = process.env): Promise<TryResult> {
  const parsed = parseStep(form);
  if (!parsed.ok) throw new RunError(parsed.error);
  const step = parsed.value;
  const position = Number(form.get("position"));
  if (!Number.isInteger(position) || position < 1 || position > 20) throw new RunError("Unknown step position.");
  if (!step.llm_model_id) throw new RunError("Choose a model for this step.");
  const model = (await modelOptions()).find((m) => m.id === step.llm_model_id);
  if (!model) throw new RunError("That model no longer exists.");
  if (!model.provider || !SUPPORTED_PROVIDERS.includes(model.provider)) throw new RunError(`No connector for provider ${model.provider ?? "(none)"}.`);
  if (step.include_image && !model.supports_vision) throw new RunError(`${model.model_id} does not accept images; untick "Sees the photo" or pick another model.`);

  const direction = String(form.get("direction") ?? "").trim();
  if ([...direction].length > 120) throw new RunError("Keep the direction under 120 characters.");
  // Earlier outputs, typed or pasted: outputs[i] is step i+1.
  const outputs: string[] = Array.from({ length: position - 1 }, (_, i) => String(form.get(`sample_${i + 1}`) ?? ""));
  if (outputs.some((o) => o.length > MAX_SAMPLE)) throw new RunError("Each earlier output must be at most 20,000 characters.");
  for (const p of placeholdersIn(step.user_prompt)) {
    if (p.step === "previous" && position === 1) throw new RunError("{previous} has no step before step 1.");
    if (typeof p.step === "number" && p.step >= position) throw new RunError(`${p.token} does not run before step ${position}.`);
    const index = p.step === "previous" ? position - 2 : typeof p.step === "number" ? p.step - 1 : null;
    if (index !== null && !outputs[index]?.trim()) throw new RunError(`Fill in the output of step ${index + 1} for ${p.token}.`);
  }

  let image: { base64: string; mime: string } | null = null;
  if (step.include_image) image = { base64: (await tryImage(form)).toString("base64"), mime: "image/jpeg" };

  const db = serviceClient();
  const { data: settings } = await db.from("humor_llm_models").select("max_output_tokens,temperature").eq("id", model.id).maybeSingle();
  const temperature = settings?.temperature == null ? null : Number(settings.temperature);
  const prompt = fillPrompt(step.user_prompt, direction, outputs);
  const started = Date.now();
  const result = await callStep({
    provider: model.provider, model: model.model_id, systemPrompt: step.system_prompt, userPrompt: prompt, image,
    json: step.output_kind === "captions", schema: step.output_schema, maxOutputTokens: settings?.max_output_tokens ?? null,
    temperature: Number.isFinite(temperature) ? temperature : null,
  }, env);
  const base = { prompt, usage: result.usage, latencyMs: Date.now() - started, model: model.label };
  if (!result.ok) return { ok: false, error: result.error, output: null, captions: null, ...base };
  if (step.output_kind !== "captions") return { ok: true, output: result.text, captions: null, ...base };
  const captions = parseCaptions(result.text);
  return captions.ok ? { ok: true, output: result.text, captions: captions.captions, ...base } : { ok: false, error: captions.error, output: result.text, captions: null, ...base };
}

// An uploaded photo, or the photo of one of this tool's earlier runs.
async function tryImage(form: FormData) {
  const runId = String(form.get("sample_run") ?? "");
  const upload = form.get("image");
  if (upload instanceof File && upload.size) {
    if (upload.size > MAX_UPLOAD_BYTES) throw new RunError("Photos must be 4 MB or smaller.");
    const bytes = new Uint8Array(await upload.arrayBuffer());
    if (!sniffImage(bytes)) throw new RunError("Choose a JPG, PNG, WebP or GIF.");
    return prepareImage(bytes);
  }
  if (!UUID.test(runId)) throw new RunError("This step sees the photo: choose one.");
  const db = serviceClient();
  const { data: run } = await db.from("humor_chain_runs").select("image_path").eq("id", runId).maybeSingle();
  if (!run) throw new RunError("That run no longer exists.");
  const { data: file, error } = await db.storage.from(storageBucket(RUN_BUCKET)).download(run.image_path);
  if (error || !file) throw new RunError("That run's photo could not be loaded.", 502);
  return Buffer.from(await file.arrayBuffer());
}

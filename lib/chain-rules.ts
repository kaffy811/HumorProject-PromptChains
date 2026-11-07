// Pure rules for chains and steps: form validation (mirrors the database
// checks), placeholders, problems that block a run, and prompt filling.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_STEPS = 20;
export const OUTPUT_KINDS = ["text", "captions"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const str = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const len = (value: string) => [...value].length;

export type ChainFields = { name: string; prompt_version: string; description: string | null; llm_model_id: string | null };
export function parseChain(form: FormData): Parsed<ChainFields> {
  const name = str(form, "name"), version = str(form, "prompt_version"), description = str(form, "description");
  if (len(name) < 1 || len(name) > 80) return { ok: false, error: "Name must be 1–80 characters." };
  if (!/^[a-z0-9][a-z0-9._-]{1,59}$/.test(version)) return { ok: false, error: "Prompt version must be 2–60 lowercase letters, digits and . _ - (e.g. captions-v4)." };
  if (len(description) > 1000) return { ok: false, error: "Description must be at most 1,000 characters." };
  const model = str(form, "llm_model_id");
  if (model && !UUID.test(model)) return { ok: false, error: "Choose a valid model." };
  return { ok: true, value: { name, prompt_version: version, description: description || null, llm_model_id: model || null } };
}

export type StepFields = {
  name: string; llm_model_id: string | null; include_image: boolean; output_kind: OutputKind;
  system_prompt: string; user_prompt: string; output_schema: object | null;
};
export function parseStep(form: FormData): Parsed<StepFields> {
  const name = str(form, "name"), model = str(form, "llm_model_id"), kind = str(form, "output_kind");
  const system = str(form, "system_prompt"), user = str(form, "user_prompt"), schemaText = str(form, "output_schema");
  if (len(name) < 1 || len(name) > 80) return { ok: false, error: "Step name must be 1–80 characters." };
  if (model && !UUID.test(model)) return { ok: false, error: "Choose a valid model." };
  if (!(OUTPUT_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Choose what the step returns." };
  if (len(system) < 1 || len(system) > 20000) return { ok: false, error: "System prompt must be 1–20,000 characters." };
  if (len(user) < 1 || len(user) > 4000) return { ok: false, error: "User prompt must be 1–4,000 characters." };
  let schema: object | null = null;
  if (schemaText) {
    if (kind !== "captions") return { ok: false, error: "An output JSON schema only applies to a step that returns captions." };
    if (len(schemaText) > 20000) return { ok: false, error: "Output JSON schema must be at most 20,000 characters." };
    try { schema = JSON.parse(schemaText); } catch { return { ok: false, error: "Output JSON schema is not valid JSON." }; }
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return { ok: false, error: "Output JSON schema must be a JSON object." };
  }
  return { ok: true, value: { name, llm_model_id: model || null, include_image: form.get("include_image") === "on", output_kind: kind as OutputKind, system_prompt: system, user_prompt: user, output_schema: schema } };
}

// {direction} = the run's direction; {previous} = the step before; {stepN} = step N's output.
export const PLACEHOLDER = /\{(direction|previous|step(\d{1,2}))\}/g;
export function placeholdersIn(template: string) {
  return [...template.matchAll(PLACEHOLDER)].map((m) => ({ token: m[0], step: m[2] ? Number(m[2]) : m[1] === "previous" ? "previous" as const : null }));
}

export type RuleStep = {
  position: number; name: string; user_prompt: string; output_kind: string; include_image: boolean;
  model: { model_id: string; is_active: boolean; supports_vision: boolean; provider: string | null } | null;
};
export type Problem = { position: number | null; message: string; blocking: boolean };

// Checked after every edit and reorder, and again before a run starts.
export function chainProblems(steps: RuleStep[], supported: string[]): Problem[] {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const problems: Problem[] = [];
  if (!ordered.length) problems.push({ position: null, message: "Add at least one step.", blocking: true });
  ordered.forEach((step, index) => {
    const n = index + 1;
    if (!step.model) problems.push({ position: n, message: "Choose a model.", blocking: true });
    else {
      if (!step.model.provider || !supported.includes(step.model.provider)) problems.push({ position: n, message: `No connector for provider ${step.model.provider ?? "(none)"}; supported: ${supported.join(", ")}.`, blocking: true });
      if (step.include_image && !step.model.supports_vision) problems.push({ position: n, message: `${step.model.model_id} does not accept images; untick "Sees the photo" or pick another model.`, blocking: true });
      if (!step.model.is_active) problems.push({ position: n, message: `${step.model.model_id} is marked inactive in LLM models.`, blocking: false });
    }
    for (const p of placeholdersIn(step.user_prompt)) {
      if (p.step === "previous" && n === 1) problems.push({ position: n, message: "{previous} has no step before it.", blocking: true });
      if (typeof p.step === "number" && p.step >= n) problems.push({ position: n, message: `${p.token} refers to a step that does not run before this one.`, blocking: true });
      if (typeof p.step === "number" && ordered[p.step - 1]?.output_kind === "captions") problems.push({ position: n, message: `${p.token} is a captions step; its JSON is passed as text.`, blocking: false });
    }
    if (n > 1 && !step.include_image && !placeholdersIn(step.user_prompt).some((p) => p.step !== null)) problems.push({ position: n, message: "Neither sees the photo nor uses an earlier step ({previous} or {stepN}).", blocking: false });
  });
  if (ordered.length && !ordered.some((s) => s.include_image)) problems.push({ position: null, message: "No step sees the photo.", blocking: false });
  const last = ordered.at(-1);
  if (last && last.output_kind !== "captions") problems.push({ position: ordered.length, message: "The last step returns text, so runs end with text instead of captions.", blocking: false });
  return problems;
}

// Fills a step's user prompt from the run's direction and earlier outputs.
export function fillPrompt(template: string, direction: string, outputs: (string | null)[]) {
  return template.replace(PLACEHOLDER, (_token, name: string, step?: string) => {
    if (name === "direction") return direction.trim() || "none";
    if (name === "previous") return outputs.at(-1) ?? "";
    return outputs[Number(step) - 1] ?? "";
  });
}

// New order after moving one step: up (-1) or down (+1), or drag from → to.
export function moveStep<T>(ids: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// "Run every step with this model" on the Generate page: the chain itself is
// unchanged; only this run's copy of the steps uses the override.
export type OverrideModel = { id: string; model_id: string; is_active: boolean; supports_vision: boolean; provider: string | null; label: string };
export function withModelOverride<T extends RuleStep & { llm_model_id: string | null; modelLabel: string | null }>(steps: T[], model: OverrideModel | null): T[] {
  if (!model) return steps;
  return steps.map((s) => ({ ...s, llm_model_id: model.id, modelLabel: model.label, model: { model_id: model.model_id, is_active: model.is_active, supports_vision: model.supports_vision, provider: model.provider } }));
}

// The chain's model: its own setting, else the model most of its steps use
// (chains from before 202611070001). mixed = steps disagree with it.
export function chainModelOf(own: string | null | undefined, steps: { position: number; llm_model_id: string | null }[]) {
  const counts = new Map<string, number>();
  for (const s of [...steps].sort((a, b) => a.position - b.position)) if (s.llm_model_id) counts.set(s.llm_model_id, (counts.get(s.llm_model_id) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const id = own ?? common;
  return { id, mixed: steps.some((s) => s.llm_model_id !== id) && steps.length > 0 };
}

// Simple steps: admins write one Prompt (the system prompt) per step; what the
// model receives as the user message is built automatically and the same way
// everywhere (tool, Humor Admin, member app read it as an ordinary template):
// the member's input, then every earlier step's output once, by name.
// Migration 202611070002 builds the identical text in SQL.
export function stepTemplate(position: number, earlierNames: string[]) {
  const parts = ["User input: {direction}"];
  for (let k = 1; k < position; k++) parts.push(`Step ${k} output (${(earlierNames[k - 1] ?? `Step ${k}`).replace(/[{}]/g, "")}):\n{step${k}}`);
  return parts.join("\n\n");
}
// Earlier steps pass text on; the last one returns the captions.
export const stepKind = (position: number, total: number): OutputKind => (position === total ? "captions" : "text");

// A template stepTemplate made (whatever the step names were then).
export function isAutoTemplate(text: string) {
  return /^User input: \{direction\}(\n\nStep \d{1,2} output \([^\n]*\):\n\{step\d{1,2}\})*$/.test(text);
}
// A hand-written user prompt (older chains, older versions) turned into plain
// instructions for the Prompt: lines with {…} go, and so does a "Label:" line
// right before one ("Photo description:" + "{previous}").
export function instructionsFrom(userPrompt: string) {
  const lines = userPrompt.split("\n");
  const has = (line: string | undefined) => line !== undefined && /\{(direction|previous|step\d{1,2})\}/.test(line);
  const kept = lines.filter((line, i) => !has(line) && !(line.trim().endsWith(":") && has(lines[i + 1])));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// The step as a simple step: Prompt (system) with any old instructions appended, generated inputs.
export function simpleStep(step: { system_prompt: string; user_prompt: string }, position: number, earlierNames: string[]) {
  const extra = isAutoTemplate(step.user_prompt) ? "" : instructionsFrom(step.user_prompt);
  const system = extra && !step.system_prompt.includes(extra) ? `${step.system_prompt.trimEnd()}\n\n${extra}` : step.system_prompt;
  return { system_prompt: system, user_prompt: stepTemplate(position, earlierNames) };
}

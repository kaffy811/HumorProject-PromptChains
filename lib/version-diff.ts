// Version history: what changed between two snapshots of a chain. Pure, so
// it is unit-tested and usable on the server and in the browser.

export type SnapshotStep = {
  position: number; name: string; llm_model_id: string | null; system_prompt: string; user_prompt: string;
  output_schema: unknown; include_image: boolean; output_kind: string;
};
export type Snapshot = { name: string; prompt_version: string; description: string | null; steps: SnapshotStep[] };
export type LinePart = { kind: "same" | "added" | "removed"; text: string };
export type FieldChange = { field: string; before: string; after: string; lines?: LinePart[] };
export type StepChange =
  | { kind: "added" | "removed"; position: number; name: string }
  | { kind: "changed"; position: number; name: string; fields: FieldChange[] };
export type SnapshotDiff = { chain: FieldChange[]; steps: StepChange[]; same: boolean };

// Accepts whatever the database holds; anything malformed becomes empty values.
export function readSnapshot(value: unknown): Snapshot {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const steps = Array.isArray(v.steps) ? v.steps : [];
  return {
    name: String(v.name ?? ""), prompt_version: String(v.prompt_version ?? ""), description: v.description == null ? null : String(v.description),
    steps: steps.map((raw, i) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      return {
        position: Number(s.position ?? i + 1), name: String(s.name ?? ""), llm_model_id: s.llm_model_id ? String(s.llm_model_id) : null,
        system_prompt: String(s.system_prompt ?? ""), user_prompt: String(s.user_prompt ?? ""), output_schema: s.output_schema ?? null,
        include_image: s.include_image !== false, output_kind: String(s.output_kind ?? "captions"),
      };
    }).sort((a, b) => a.position - b.position),
  };
}

// Line diff by longest common subsequence; prompts are short, so O(n·m) is fine.
export function lineDiff(before: string, after: string): LinePart[] {
  const a = before.split("\n"), b = after.split("\n");
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const parts: LinePart[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { parts.push({ kind: "same", text: a[i] }); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) parts.push({ kind: "removed", text: a[i++] });
    else parts.push({ kind: "added", text: b[j++] });
  }
  while (i < a.length) parts.push({ kind: "removed", text: a[i++] });
  while (j < b.length) parts.push({ kind: "added", text: b[j++] });
  return parts;
}

const schemaText = (value: unknown) => (value == null ? "none" : JSON.stringify(value, null, 2));

// Steps are matched by position, the way they run.
export function diffSnapshots(beforeRaw: unknown, afterRaw: unknown, modelName: (id: string | null) => string): SnapshotDiff {
  const before = readSnapshot(beforeRaw), after = readSnapshot(afterRaw);
  const chain: FieldChange[] = [];
  const field = (list: FieldChange[], name: string, a: string, b: string, multiline = false) => {
    if (a !== b) list.push({ field: name, before: a, after: b, ...(multiline ? { lines: lineDiff(a, b) } : {}) });
  };
  field(chain, "Name", before.name, after.name);
  field(chain, "Prompt version", before.prompt_version, after.prompt_version);
  field(chain, "Description", before.description ?? "", after.description ?? "", true);
  const steps: StepChange[] = [];
  const count = Math.max(before.steps.length, after.steps.length);
  for (let i = 0; i < count; i++) {
    const a = before.steps[i], b = after.steps[i];
    if (!a) { steps.push({ kind: "added", position: i + 1, name: b.name }); continue; }
    if (!b) { steps.push({ kind: "removed", position: i + 1, name: a.name }); continue; }
    const fields: FieldChange[] = [];
    field(fields, "Name", a.name, b.name);
    field(fields, "Model", modelName(a.llm_model_id), modelName(b.llm_model_id));
    field(fields, "Sees the photo", a.include_image ? "yes" : "no", b.include_image ? "yes" : "no");
    field(fields, "Returns", a.output_kind, b.output_kind);
    field(fields, "System prompt", a.system_prompt, b.system_prompt, true);
    field(fields, "User prompt", a.user_prompt, b.user_prompt, true);
    field(fields, "Output schema", schemaText(a.output_schema), schemaText(b.output_schema), true);
    if (fields.length) steps.push({ kind: "changed", position: i + 1, name: b.name, fields });
  }
  return { chain, steps, same: !chain.length && !steps.length };
}

// Short summary for the history list, e.g. "3 steps · Gemini 3.8 Flash".
export function snapshotSummary(raw: unknown, modelName: (id: string | null) => string) {
  const s = readSnapshot(raw);
  const models = [...new Set(s.steps.map((step) => modelName(step.llm_model_id)))];
  return `${s.steps.length} step${s.steps.length === 1 ? "" : "s"}${models.length ? ` · ${models.length > 2 ? `${models.length} models` : models.join(" + ")}` : ""}`;
}

// Default duplicate names: "Campus captions (copy)" and "campus-captions-v4-copy",
// numbered when taken; prompt versions stay within the 60-character rule.
export function copyNames(name: string, version: string, taken: string[]) {
  const used = new Set(taken);
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? "-copy" : `-copy${n}`;
    const candidate = version.slice(0, 60 - suffix.length).replace(/[-._]+$/, "") + suffix;
    if (!used.has(candidate)) return { name: `${name.slice(0, 70)} (copy${n === 1 ? "" : ` ${n}`})`, prompt_version: candidate };
  }
  return { name: `${name.slice(0, 70)} (copy)`, prompt_version: "" };
}

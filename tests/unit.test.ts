// Pure unit tests: no network, no database.
import assert from "node:assert/strict";
import { gateDecision, isPublicPath, isSuperadmin, safeNext } from "../lib/gate";
import { chainProblems, fillPrompt, moveStep, parseChain, parseStep, placeholdersIn } from "../lib/chain-rules";
import { callStep, parseCaptions } from "../lib/llm";

const id = "11111111-1111-4111-8111-111111111111";
const google = { id, is_anonymous: false, identities: [{ provider: "google" }] } as never;
const claims = { sub: id, amr: [{ method: "oauth", timestamp: 10 }] };

// Gate: only a fresh Google session with is_superadmin === true. is_admin is not enough.
assert.equal(gateDecision(null, null, null), "anonymous");
assert.equal(gateDecision(google, claims, { is_superadmin: true }), "allowed");
assert.equal(gateDecision(google, claims, { is_superadmin: false }), "forbidden");
assert.equal(gateDecision(google, claims, { is_superadmin: false, is_admin: true } as never), "forbidden", "admins are not superadmins");
for (const bad of [null, "true", 1, undefined]) assert.equal(isSuperadmin({ is_superadmin: bad }), false, String(bad));
assert.equal(gateDecision(google, { sub: id, amr: [{ method: "password", timestamp: 10 }] }, { is_superadmin: true }), "not-google");
assert.equal(gateDecision({ ...(google as object), is_anonymous: true } as never, claims, { is_superadmin: true }), "not-google");
for (const path of ["/login", "/denied", "/auth/start", "/auth/callback"]) assert.equal(isPublicPath(path), true, path);
for (const path of ["/", "/chains/x", "/runs/x", "/api/runs", "/loginx"]) assert.equal(isPublicPath(path), false, path);
assert.equal(safeNext("/chains/x?created=1"), "/chains/x?created=1");
for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "/login", null]) assert.equal(safeNext(bad), "/");
console.log("PASS superadmin-only gate and safe redirects.");

// Chain and step forms mirror the database checks.
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
assert.deepEqual(parseChain(form({ name: " Demo ", prompt_version: "demo-v2", description: "" })), { ok: true, value: { name: "Demo", prompt_version: "demo-v2", description: null, llm_model_id: null } });
assert.equal(parseChain(form({ name: "D", prompt_version: "demo-v2", llm_model_id: "nope" })).ok, false, "model must be an id");
assert.equal(parseChain(form({ name: "Demo", prompt_version: "Demo V2" })).ok, false);
assert.equal(parseChain(form({ name: "", prompt_version: "demo-v2" })).ok, false);
const model = "22222222-2222-4222-8222-222222222222";
const step = (extra: Record<string, string>) => parseStep(form({ name: "Describe", llm_model_id: model, output_kind: "text", system_prompt: "sys", user_prompt: "Describe {direction}", ...extra }));
assert.deepEqual(step({ include_image: "on" }), { ok: true, value: { name: "Describe", llm_model_id: model, include_image: true, output_kind: "text", system_prompt: "sys", user_prompt: "Describe {direction}", output_schema: null } });
assert.equal((step({}) as { value: { include_image: boolean } }).value.include_image, false, "unticked = no photo");
assert.equal(step({ llm_model_id: "" }).ok, true, "model may be chosen later");
assert.equal(step({ llm_model_id: "nope" }).ok, false);
assert.equal(step({ output_kind: "image" }).ok, false);
assert.equal(step({ system_prompt: " " }).ok, false);
assert.match((step({ output_schema: "{}" }) as { error: string }).error, /only applies to a step that returns captions/);
assert.deepEqual((step({ output_kind: "captions", output_schema: ' {"type":"object"} ' }) as { value: { output_schema: object } }).value.output_schema, { type: "object" });
assert.equal(step({ output_kind: "captions", output_schema: "[1]" }).ok, false);
assert.equal(step({ output_kind: "captions", output_schema: "{nope" }).ok, false);
console.log("PASS chain and step validation.");

// Placeholders and prompt filling.
assert.deepEqual(placeholdersIn("{direction} {previous} {step2} {other}").map((p) => p.step), [null, "previous", 2]);
assert.equal(fillPrompt("Dir: {direction}. Prev: {previous}. First: {step1}.", "  ", ["A", "B"]), "Dir: none. Prev: B. First: A.");
assert.equal(fillPrompt("{previous}|{step3}", "x", ["A"]), "A|", "missing outputs fill empty");
assert.equal(fillPrompt("{direction}", "midterms", []), "midterms");
console.log("PASS placeholders and prompt filling.");

// Reordering moves one step and keeps the rest in order.
assert.deepEqual(moveStep(["a", "b", "c"], 1, 0), ["b", "a", "c"], "move step 2 to step 1");
assert.deepEqual(moveStep(["a", "b", "c"], 0, 2), ["b", "c", "a"], "drag first to last");
assert.deepEqual(moveStep(["a", "b", "c"], 2, 2), ["a", "b", "c"]);
assert.deepEqual(moveStep(["a", "b"], 0, 5), ["a", "b"], "out of range is ignored");
console.log("PASS step reordering.");

// Problems that block a run, recomputed for any order.
const m = (extra = {}) => ({ model_id: "gemini-x", is_active: true, supports_vision: true, provider: "google", ...extra });
const s = (position: number, extra: Record<string, unknown> = {}) => ({ position, name: `s${position}`, user_prompt: "{previous}", output_kind: "text", include_image: false, model: m(), ...extra });
const supported = ["google", "openai"];
const demo = [s(1, { user_prompt: "Describe. {direction}", include_image: true }), s(2), s(3, { output_kind: "captions" })];
assert.deepEqual(chainProblems(demo, supported), [], "the example chain is clean");
const swapped = chainProblems([{ ...demo[1], position: 1 }, { ...demo[0], position: 2 }, demo[2]], supported);
assert.ok(swapped.some((p) => p.position === 1 && p.blocking && /\{previous\} has no step before it/.test(p.message)), "moving a {previous} step to the top blocks");
assert.ok(chainProblems([s(1, { user_prompt: "{step2}", include_image: true }), s(2, { output_kind: "captions" })], supported).some((p) => p.blocking && /does not run before/.test(p.message)));
assert.ok(chainProblems([s(1, { model: null, include_image: true, user_prompt: "x", output_kind: "captions" })], supported).some((p) => p.blocking && /Choose a model/.test(p.message)));
assert.ok(chainProblems([s(1, { include_image: true, user_prompt: "x", output_kind: "captions", model: m({ provider: "anthropic" }) })], supported).some((p) => p.blocking && /No connector/.test(p.message)));
assert.ok(chainProblems([s(1, { include_image: true, user_prompt: "x", output_kind: "captions", model: m({ supports_vision: false }) })], supported).some((p) => p.blocking && /does not accept images/.test(p.message)));
const soft = chainProblems([s(1, { user_prompt: "x" })], supported);
assert.ok(soft.every((p) => !p.blocking) && soft.some((p) => /No step sees the photo/.test(p.message)) && soft.some((p) => /returns text/.test(p.message)));
assert.ok(chainProblems([], supported).some((p) => p.blocking && /at least one step/.test(p.message)));
console.log("PASS chain problems.");

// Connectors: text steps are plain, caption steps ask for JSON; image only when the step sees it.
void (async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fake = (responses: { status: number; body: unknown }[]) => (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  const base = { provider: "google", model: "gemini-x", systemPrompt: "sys", userPrompt: "describe", image: null, json: false, schema: null, maxOutputTokens: null, temperature: null };
  const gem = (text: string) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: "hmm", thought: true }, { text }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 } } });

  let r = await callStep(base, { GEMINI_API_KEY: "g" }, fake([gem("A cat on Low Steps.")]));
  assert.deepEqual(r, { ok: true, text: "A cat on Low Steps.", usage: { input: 5, output: 2, total: 7 } });
  assert.equal("responseMimeType" in (calls[0].body.generationConfig as object), false, "text step: no JSON mode");
  assert.equal((calls[0].body.contents as { parts: unknown[] }[])[0].parts.length, 1, "no photo attached");
  calls.length = 0;
  await callStep({ ...base, image: { base64: "QUJD", mime: "image/jpeg" }, json: true, schema: { type: "object" }, temperature: 0.5 }, { GEMINI_API_KEY: "g" }, fake([gem("{}")]));
  const config = calls[0].body.generationConfig as Record<string, unknown>;
  assert.equal(config.responseMimeType, "application/json"); assert.deepEqual(config.responseJsonSchema, { type: "object" }); assert.equal(config.temperature, 0.5);
  assert.equal((calls[0].body.contents as { parts: unknown[] }[])[0].parts.length, 2, "photo attached");

  calls.length = 0;
  r = await callStep({ ...base, provider: "openai", model: "gpt-x", json: true, schema: { type: "object" } }, { OPENAI_API_KEY: "k" },
    fake([{ status: 400, body: { error: { message: "Invalid schema for response_format" } } }, { status: 200, body: { choices: [{ message: { content: '{"captions":["a"]}' } }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } } }]));
  assert.equal(r.ok, true); assert.equal((calls[1].body.response_format as { type: string }).type, "json_object", "schema rejected → JSON mode");
  calls.length = 0;
  await callStep({ ...base, provider: "openai", model: "gpt-x" }, { OPENAI_API_KEY: "k" }, fake([{ status: 200, body: { choices: [{ message: { content: "Funny." } }] } }]));
  assert.equal("response_format" in calls[0].body, false, "text step: plain completion");
  assert.equal((calls[0].body.messages as { content: unknown[] }[])[1].content.length, 1);

  r = await callStep({ ...base, provider: "openai" }, { OPENAI_API_KEY: "k" }, fake([{ status: 429, body: { error: { message: "no credits" } } }]));
  assert.deepEqual(r.ok ? null : r.error, "OpenAI returned HTTP 429: no credits");
  const noKey = await callStep(base, {}, fake([]));
  assert.equal(noKey.ok, false); assert.match(noKey.ok ? "" : noKey.error, /GEMINI_API_KEY is not set/);
  const missing = await callStep({ ...base, provider: "anthropic" }, {}, fake([]));
  assert.equal(missing.ok, false); assert.match(missing.ok ? "" : missing.error, /No connector for provider "anthropic"/);

  // Final captions: objects, strings, fences, any count.
  assert.deepEqual(parseCaptions('```json\n{"captions":[{"caption":"A","style":"pun"},"B",{"text":"C"}]}\n```'), { ok: true, captions: [{ caption: "A", style: "pun" }, { caption: "B", style: "" }, { caption: "C", style: "" }] });
  assert.equal(parseCaptions('["x","y","z","w","v"]').ok, true, "a bare list of five");
  assert.equal(parseCaptions("not json").ok, false);
  assert.equal(parseCaptions('{"captions":[]}').ok, false);
  assert.equal(parseCaptions('{"captions":[" "]}').ok, false);
  console.log("PASS model connectors and caption parsing.");
})().catch((error) => { console.error(error); process.exit(1); });

// Phase 1: flow diagram edges, model override, dashboard stats.
import { flowEdges, estimateTokens } from "../lib/flow";
import { withModelOverride } from "../lib/chain-rules";
import { runStats } from "../lib/stats";
{
  const f = (include_image: boolean, user_prompt: string, output_kind = "text") => ({ include_image, user_prompt, output_kind });
  // The example chain: photo → 1 → 2 → 3 → captions.
  assert.deepEqual(flowEdges([f(true, "Describe {direction}"), f(false, "{previous}"), f(false, "{previous}", "captions")]).map((e) => `${e.from}>${e.to}:${e.kind}`),
    ["0>1:photo", "1>2:previous", "2>3:previous", "3>4:result"]);
  // {step1} two steps later arcs over; a step with no data link still shows run order.
  assert.deepEqual(flowEdges([f(true, "x"), f(true, "unrelated"), f(false, "{step1} and {previous}", "captions")]).map((e) => `${e.from}>${e.to}:${e.kind}`),
    ["0>1:photo", "0>2:photo", "1>3:step", "2>3:previous", "3>4:result", "1>2:order"]);
  // References that point forwards (after a bad reorder) draw nothing; duplicates collapse.
  assert.deepEqual(flowEdges([f(false, "{step2} {previous}"), f(false, "{previous} {step1}")]).map((e) => `${e.from}>${e.to}:${e.kind}`), ["1>2:previous", "2>3:result"]);
  assert.deepEqual(flowEdges([]), []);
  assert.equal(estimateTokens("abcdefgh"), 2); assert.equal(estimateTokens(""), 0);

  const step = { position: 1, name: "s", user_prompt: "{direction}", output_kind: "captions", include_image: true, llm_model_id: "a", modelLabel: "Gemini", model: { model_id: "gemini-x", is_active: true, supports_vision: true, provider: "google" } };
  const gpt = { id: "b", model_id: "gpt-x", is_active: true, supports_vision: true, provider: "openai", label: "GPT" };
  const swapped = withModelOverride([step, { ...step, position: 2 }], gpt);
  assert.deepEqual(swapped.map((s) => [s.llm_model_id, s.model!.provider, s.modelLabel]), [["b", "openai", "GPT"], ["b", "openai", "GPT"]]);
  assert.equal(step.llm_model_id, "a", "the chain's own steps are not changed");
  assert.equal(withModelOverride([step], null)[0], step);
  const blind = withModelOverride([step], { ...gpt, supports_vision: false });
  assert.ok(chainProblems(blind, ["google", "openai"]).some((p) => p.blocking && /does not accept images/.test(p.message)), "a text-only override cannot run a photo step");

  const now = new Date("2026-11-05T12:00:00Z");
  const day = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const runs = [
    { id: "a", status: "completed", created_at: day(0.1), completed_at: null },
    { id: "b", status: "completed", created_at: day(1), completed_at: null },
    { id: "c", status: "failed", created_at: day(2), completed_at: null },
    { id: "d", status: "running", created_at: day(3), completed_at: null },
    { id: "e", status: "completed", created_at: day(9), completed_at: null },
  ];
  const steps = [
    { run_id: "a", usage: { total: 100 }, latency_ms: 2000 }, { run_id: "a", usage: { total: 50 }, latency_ms: 1000 },
    { run_id: "b", usage: { total: 10 }, latency_ms: 5000 }, { run_id: "c", usage: null, latency_ms: 400 }, { run_id: "e", usage: { total: 999 }, latency_ms: 1 },
  ];
  const st = runStats(runs, steps, now);
  assert.equal(st.runsWeek, 4); assert.equal(st.runsLastWeek, 1);
  assert.equal(st.successRate, 2 / 3, "running runs are not counted as finished");
  assert.equal(st.tokensWeek, 160, "last week's tokens are excluded");
  assert.equal(st.medianMs, 4000, "median of completed runs' total model time (3000, 5000)");
  assert.equal(st.days.length, 7); assert.equal(st.days[6].date, "2026-11-05");
  assert.equal(st.days.reduce((n, d) => n + d.runs, 0), 4); assert.equal(st.days.find((d) => d.date === "2026-11-03")!.failed, 1);
  assert.equal(runStats([], [], now).successRate, null);
  console.log("PASS flow diagram edges, model override and dashboard stats.");
}

// Version history: line diff, snapshot diff, summaries and copy names.
import { copyNames, diffSnapshots, lineDiff, readSnapshot, snapshotSummary } from "../lib/version-diff";
{
  assert.deepEqual(lineDiff("a\nb\nc", "a\nB\nc\nd"), [{ kind: "same", text: "a" }, { kind: "removed", text: "b" }, { kind: "added", text: "B" }, { kind: "same", text: "c" }, { kind: "added", text: "d" }]);
  assert.deepEqual(lineDiff("same", "same"), [{ kind: "same", text: "same" }]);
  const st = (position: number, extra = {}) => ({ position, name: `S${position}`, llm_model_id: "g", system_prompt: "sys", user_prompt: "u {direction}", output_schema: null, include_image: position === 1, output_kind: position === 3 ? "captions" : "text", ...extra });
  const v1 = { name: "Campus", prompt_version: "campus-v4", description: null, steps: [st(1), st(2), st(3)] };
  const names = (id: string | null) => ({ g: "Gemini", o: "GPT" } as Record<string, string>)[id ?? ""] ?? "no model";
  assert.equal(diffSnapshots(v1, v1, names).same, true);
  const v2 = { ...v1, name: "Campus 2", steps: [st(1, { llm_model_id: "o" }), st(2, { user_prompt: "u {direction}\nmore" })] };
  const d = diffSnapshots(v1, v2, names);
  assert.deepEqual(d.chain.map((c) => [c.field, c.before, c.after]), [["Name", "Campus", "Campus 2"]]);
  assert.deepEqual(d.steps.map((s) => [s.kind, s.position]), [["changed", 1], ["changed", 2], ["removed", 3]]);
  const first = d.steps[0] as Extract<typeof d.steps[number], { kind: "changed" }>;
  assert.deepEqual(first.fields.map((f) => [f.field, f.before, f.after]), [["Model", "Gemini", "GPT"]]);
  const second = d.steps[1] as Extract<typeof d.steps[number], { kind: "changed" }>;
  assert.deepEqual(second.fields[0].lines?.map((l) => l.kind), ["same", "added"]);
  assert.equal(diffSnapshots(v2, v1, names).steps.at(-1)!.kind, "added");
  assert.deepEqual(readSnapshot(null), { name: "", prompt_version: "", description: null, steps: [] }, "malformed snapshot reads as empty");
  assert.equal(readSnapshot({ steps: [{ position: 2 }, { position: 1, include_image: false }] }).steps[0].include_image, false, "steps sorted by position");
  assert.equal(snapshotSummary(v1, names), "3 steps · Gemini"); assert.equal(snapshotSummary(v2, names), "2 steps · GPT + Gemini");
  assert.deepEqual(copyNames("Campus", "campus-v4", []), { name: "Campus (copy)", prompt_version: "campus-v4-copy" });
  assert.deepEqual(copyNames("Campus", "campus-v4", ["campus-v4-copy"]), { name: "Campus (copy 2)", prompt_version: "campus-v4-copy2" });
  const long = copyNames("x", "a".repeat(60), []);
  assert.ok(/^[a-z0-9][a-z0-9._-]{1,59}$/.test(long.prompt_version), "copy version stays valid");
  console.log("PASS version diff, summaries and copy names.");
}

// The chain's model: its own setting, else what most steps use; mixed when a step differs.
import { chainModelOf } from "../lib/chain-rules";
{
  const st = (position: number, llm_model_id: string | null) => ({ position, llm_model_id });
  assert.deepEqual(chainModelOf("g", [st(1, "g"), st(2, "g")]), { id: "g", mixed: false });
  assert.deepEqual(chainModelOf(null, [st(1, "o"), st(2, "g"), st(3, "g")]), { id: "g", mixed: true }, "most common before the column exists");
  assert.deepEqual(chainModelOf(null, [st(2, "g"), st(1, "o")]), { id: "o", mixed: true }, "ties go to the earliest step");
  assert.deepEqual(chainModelOf("o", [st(1, "g")]), { id: "o", mixed: true }, "the chain's setting wins");
  assert.deepEqual(chainModelOf(null, []), { id: null, mixed: false });
  assert.deepEqual(chainModelOf("g", [st(1, null)]), { id: "g", mixed: true }, "a step with no model");
  const d = diffSnapshots({ name: "a", prompt_version: "v", llm_model_id: "g", steps: [] }, { name: "a", prompt_version: "v", llm_model_id: "o", steps: [] }, (id) => id ?? "none");
  assert.deepEqual(d.chain.map((c) => [c.field, c.before, c.after]), [["Chain model", "g", "o"]]);
  assert.equal(diffSnapshots({ name: "a", steps: [] }, { name: "a", llm_model_id: "o", steps: [] }, (id) => id ?? "none").same, true, "older snapshots have no chain model to compare");
  console.log("PASS chain model.");
}

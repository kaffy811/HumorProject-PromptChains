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
assert.deepEqual(parseChain(form({ name: " Demo ", prompt_version: "demo-v2", description: "" })), { ok: true, value: { name: "Demo", prompt_version: "demo-v2", description: null } });
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

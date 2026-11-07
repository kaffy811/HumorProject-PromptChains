// End-to-end gate check against `next start` and a local fake Supabase.
// Usage: npm run test:e2e (builds with fake env first). Never talks to a deployed project.
// SCREENSHOTS=<dir> also saves light and dark screenshots of every page (needs Playwright).
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const SUPA_PORT = 54399, APP_PORT = 3021;
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";   // is_superadmin
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";   // is_admin only
const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHAIN = "11111111-1111-4111-8111-000000000001", RUN = "11111111-1111-4111-8111-000000000002";
const M1 = "11111111-1111-4111-8111-000000000003", P1 = "11111111-1111-4111-8111-000000000004";
const now = "2026-11-04T18:00:00Z";
const model = { model_id: "gemini-3.8-flash", display_name: "Gemini 3.8 Flash", is_active: true, supports_vision: true, humor_llm_providers: { slug: "google", name: "Google Gemini" } };
const step = (n, name, include_image, output_kind, user_prompt) => ({ id: `11111111-1111-4111-8111-10000000000${n}`, position: n, name, llm_model_id: M1, include_image, output_kind, system_prompt: `System prompt for ${name}.`, user_prompt, output_schema: null, humor_llm_models: model });
const steps = [
  step(1, "Describe the photo", true, "text", "Describe this photo in 3 to 5 sentences.\nThe member's direction, if any: {direction}"),
  step(2, "Find the funny", false, "text", "Photo description:\n{previous}\n\nWrite a short observational comedy bit."),
  step(3, "Five short captions", false, "captions", "Comedy bit:\n{previous}\n\nWrite five short, funny captions."),
];
const T = {
  profiles: [
    { id: OWNER, username: "owner", first_name: "Hana", last_name: "Lee", display_name: null, avatar_path: null, is_superadmin: true, is_admin: false },
    { id: ADMIN, username: "helper", is_superadmin: false, is_admin: true },
    { id: MEMBER, username: "member", is_superadmin: false, is_admin: false },
  ],
  humor_prompt_chains: [
    { id: CHAIN, name: "Describe → funny → five captions", prompt_version: "demo-three-step-v1", description: "Example three-step chain from the assignment.", created_at: now, updated_at: now, humor_prompt_chain_mix: null, humor_prompt_chain_steps: steps },
    { id: "11111111-1111-4111-8111-000000000009", name: "Four-style campus captions", prompt_version: "caption-styles-v3", description: null, created_at: now, updated_at: now, humor_prompt_chain_mix: { share: 100 }, humor_prompt_chain_steps: [{ ...step(1, "Caption the photo", true, "captions", "Image: [image]\nDirection: {direction}"), id: "11111111-1111-4111-8111-200000000001" }] },
  ],
  humor_llm_models: [{ id: M1, ...model }, { id: "11111111-1111-4111-8111-000000000005", model_id: "gpt-6-astra", display_name: "GPT-6 Astra", is_active: true, supports_vision: true, humor_llm_providers: { slug: "openai", name: "OpenAI" } }],
  humor_chain_runs: [{ id: RUN, chain_id: CHAIN, chain_name: "Describe → funny → five captions", prompt_version: "demo-three-step-v1", image_path: `${RUN}.jpg`, status: "completed", direction: "midterms week", step_count: 3, created_at: now, completed_at: now, final_output: null,
    captions: [{ caption: "Butler at 2am: where dreams go to study.", style: "deadpan" }, { caption: "Peak academic weapon, powered by vending machine coffee.", style: "roast" }, { caption: "Booked and very busy.", style: "pun" }, { caption: "Hi tired, I'm dad.", style: "dad joke" }, { caption: "The library chair has filed for custody.", style: "absurd" }] }],
  humor_chain_run_steps: steps.map((s, i) => ({ run_id: RUN, position: s.position, step_id: s.id, name: s.name, provider: "google", model: "gemini-3.8-flash", include_image: s.include_image, output_kind: s.output_kind, status: "completed", system_prompt: s.system_prompt, user_prompt_template: s.user_prompt, user_prompt: s.user_prompt.replace("{direction}", "midterms week").replace("{previous}", "(previous output)"), usage: { input: 900 - i * 300, output: 120, total: 1020 - i * 300 }, latency_ms: 4200 - i * 1500,
    output: ["A student is asleep face-down on a desk in Butler Library, surrounded by open textbooks and an empty coffee cup.", "Nothing says midterms like Butler at 2am: the coffee is empty, the textbooks are open, and the only thing studying is the desk.", '{"captions":[{"caption":"Butler at 2am: where dreams go to study.","style":"deadpan"}]}'][i] })),
  humor_prompt_chain_steps: steps.map((s) => ({ ...s, chain_id: CHAIN })),
  humor_prompt_chain_versions: [
    { id: "11111111-1111-4111-8111-300000000002", chain_id: CHAIN, version: 2, label: "Edited step 2 (Find the funny)", created_by: OWNER, created_at: now, snapshot: { name: "Describe → funny → five captions", prompt_version: "demo-three-step-v1", description: null, steps: steps.map((s) => ({ ...s, llm_model_id: M1 })) } },
    { id: "11111111-1111-4111-8111-300000000001", chain_id: CHAIN, version: 1, label: "Version before history was kept", created_by: null, created_at: now, snapshot: { name: "Describe → funny → five captions", prompt_version: "demo-three-step-v1", description: null, steps: steps.map((s, i) => ({ ...s, llm_model_id: M1, user_prompt: i === 1 ? "Photo description:\n{previous}\n\nWrite a joke." : s.user_prompt })) } },
  ],
  humor_captions: [{ id: P1, content: "When the 1 train is the only thing on time", deleted_at: null, image_id: "i1", source: "ai", humor_images: { storage_path: "u/i1.webp", status: "ready" } }],
  humor_generations: [{ id: "g1", image_id: "i1", image_path: "u/i1.png", status: "completed", prompt_version: "demo-three-step-v1", created_at: now, caption_candidates: [{ text: "When the 1 train is the only thing on time" }, { text: "Express to nowhere" }] }],
};
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (sub, method = "oauth") => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", exp: 4102444800, amr: [{ method, timestamp: 1 }], app_metadata: { providers: ["google"] } })}.sig`;
const userFor = (token) => {
  const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
  return { id: sub, aud: "authenticated", role: "authenticated", email: `${sub.slice(0, 4)}@example.edu`, is_anonymous: false, identities: [{ provider: "google", id: sub, user_id: sub }], app_metadata: { providers: ["google"] }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
};
const cookie = (sub, method) => {
  const token = jwt(sub, method);
  const session = { access_token: token, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user: userFor(token) };
  return `sb-localhost-auth-token=base64-${b64(session)}`;
};
// A 1×1 grey PNG for every signed image URL.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+P9/PQAJYwPZm3oQZQAAAABJRU5ErkJggg==", "base64");

const writes = [];
const supa = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (process.env.DEBUG_MOCK) console.error("mock", req.method, req.url);
  const send = (status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  let raw = "";
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const chunk of req) raw += chunk;
    writes.push({ method: req.method, path: url.pathname, body: raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null });
    if (req.method === "POST" && url.pathname === "/rest/v1/humor_prompt_chain_steps") return send(201, { id: "11111111-1111-4111-8111-100000000099" });
  }
  if (url.pathname === "/auth/v1/user") {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    return token.split(".").length === 3 ? send(200, userFor(token)) : send(401, { message: "bad jwt" });
  }
  if (url.pathname.startsWith("/storage/v1/object/sign/")) {
    const paths = JSON.parse(raw || "{}").paths ?? [];
    return send(200, paths.map((path) => ({ path, signedURL: `/object/pixel?p=${encodeURIComponent(path)}`, error: null })));
  }
  if (url.pathname === "/storage/v1/object/pixel") { res.writeHead(200, { "content-type": "image/png" }); return res.end(PIXEL); }
  if (url.pathname.startsWith("/storage/")) return send(200, []);
  if (url.pathname === "/rest/v1/rpc/humor_duplicate_prompt_chain") return send(200, CHAIN);
  if (url.pathname === "/rest/v1/rpc/humor_restore_prompt_chain_version") return send(200, 3);
  if (url.pathname.startsWith("/rest/v1/rpc/")) return send(200, null);
  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.split("/").pop();
    let rows = T[table] ?? [];
    for (const [key, value] of url.searchParams) {
      if (key.includes(".")) continue;
      if (value.startsWith("eq.")) rows = rows.filter((row) => String(row[key]) === value.slice(3));
      if (value.startsWith("in.(")) rows = rows.filter((row) => value.slice(4, -1).split(",").includes(String(row[key])));
    }
    const headers = { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` };
    if (req.method === "HEAD") { res.writeHead(200, headers); return res.end(); }
    if ((req.headers.accept || "").includes("vnd.pgrst.object")) return rows.length === 1 ? send(200, rows[0], headers) : send(406, { message: "no rows" });
    return send(200, rows, headers);
  }
  send(404, { message: "not mocked" });
});
await new Promise((resolve) => supa.listen(SUPA_PORT, resolve));
const app = spawn("node", ["node_modules/next/dist/bin/next", "start", "--port", String(APP_PORT), "--hostname", "127.0.0.1"], {
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${SUPA_PORT}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let log = "";
app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;
try {
  for (let i = 0; i < 60 && !log.includes("Ready"); i++) await new Promise((r) => setTimeout(r, 500));
  const get = (path, headers = {}) => fetch(`${ORIGIN}${path}`, { redirect: "manual", headers });
  const pages = ["/", "/chains", `/chains/${CHAIN}`, `/chains/${CHAIN}/run`, `/chains/${CHAIN}/media`, `/chains/${CHAIN}/history`, `/runs/${RUN}`];
  for (const path of pages) {
    const anon = await get(path);
    assert.equal(anon.status, 307, `anonymous ${path}`); assert.match(anon.headers.get("location"), /\/login/);
    for (const [who, sub] of [["member", MEMBER], ["admin (not superadmin)", ADMIN]]) {
      const res = await get(path, { cookie: cookie(sub) });
      assert.equal(res.status, 307, `${who} ${path}`); assert.match(res.headers.get("location"), /\/denied\?reason=forbidden/, `${who} ${path}`);
    }
    const password = await get(path, { cookie: cookie(OWNER, "password") });
    assert.match(password.headers.get("location") || "", /\/denied\?reason=not-google/, `password session ${path}`);
    const owner = await get(path, { cookie: cookie(OWNER) });
    assert.equal(owner.status, 200, `superadmin ${path}: ${owner.status}\n${log.slice(-2000)}`);
    assert.equal(owner.headers.get("cache-control"), "private, no-store");
  }
  const dash = await (await get("/", { cookie: cookie(OWNER) })).text();
  for (const text of ["Hi, Hana", "Runs, last 7 days", "Success rate", "Recent runs", "For members", "Four-style campus captions", "Account menu for Hana Lee"]) assert.match(dash, new RegExp(text), `dashboard: ${text}`);
  const list = await (await get("/chains", { cookie: cookie(OWNER) })).text();
  assert.match(list, /Describe → funny → five captions/); assert.match(list, /Ready to run/); assert.match(list, /Members use this/); assert.match(list, /class="mini-flow"/);
  assert.match(await (await get("/chains?new=1", { cookie: cookie(OWNER) })).text(), /<details class="card" id="new" open=""/, "?new=1 opens the create form");
  const editor = await (await get(`/chains/${CHAIN}`, { cookie: cookie(OWNER) })).text();
  for (const text of ["Steps in run order", "Step 2: Find the funny", "returns captions", "Delete chain", "Click a step to edit it"]) assert.match(editor, new RegExp(text), text);
  for (const text of ["Chain settings", "Save settings", "Duplicate", "demo-three-step-v1-copy", "History"]) assert.match(editor, new RegExp(text), text);
  const history = await (await get(`/chains/${CHAIN}/history`, { cookie: cookie(OWNER) })).text();
  for (const text of ["Version 1 → 2", "Edited step 2", "Write a joke.", "Write a short observational comedy bit.", "Hana Lee", "migration", "vs current", "Restore"]) assert.match(history, new RegExp(text), `history: ${text}`);
  const run = await (await get(`/chains/${CHAIN}/run`, { cookie: cookie(OWNER) })).text();
  assert.match(run, /As set in each step \(Gemini 3.8 Flash · Google Gemini\)/); assert.match(run, /Every step: GPT-6 Astra · OpenAI/);
  const media = await (await get(`/chains/${CHAIN}/media`, { cookie: cookie(OWNER) })).text();
  assert.match(media, /Butler at 2am/); assert.match(media, /Express to nowhere/, "member posts with this version");
  const detail = await (await get(`/runs/${RUN}`, { cookie: cookie(OWNER) })).text();
  assert.match(detail, /asleep face-down/); assert.match(detail, /Five short captions/);
  assert.equal((await get("/chains/not-a-uuid", { cookie: cookie(OWNER) })).status, 404);
  // API: proxy refuses non-superadmins; the route refuses requests from other sites.
  const post = (path, sub, origin) => fetch(`${ORIGIN}${path}`, { method: "POST", redirect: "manual", headers: { cookie: cookie(sub), ...(origin ? { origin } : {}) }, body: new FormData() });
  assert.equal((await post("/api/runs", ADMIN, ORIGIN)).status, 403, "admins cannot run chains");
  assert.equal((await post("/api/runs", OWNER, "https://evil.example")).status, 403, "cross-site request refused");
  assert.equal((await post("/api/runs", OWNER)).status, 403, "no Origin refused");
  const missing = await post("/api/runs", OWNER, ORIGIN);
  assert.equal(missing.status, 400); assert.match((await missing.json()).error, /Unknown prompt chain/);
  assert.equal((await post(`/api/runs/not-a-run/steps/1`, OWNER, ORIGIN)).status, 400);
  assert.equal((await post("/api/steps/try", ADMIN, ORIGIN)).status, 403, "admins cannot test steps");
  assert.equal((await post("/api/steps/try", OWNER, "https://evil.example")).status, 403);
  const tryEmpty = await post("/api/steps/try", OWNER, ORIGIN);
  assert.equal(tryEmpty.status, 400); assert.match((await tryEmpty.json()).error, /Step name/);
  const login = await get("/login");
  assert.equal(login.status, 200); assert.equal(login.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(await login.text(), /localStorage.getItem\(&quot;theme&quot;\)|localStorage\.getItem\("theme"\)/, "theme applied before paint");
  console.log("PASS anonymous → /login; members, admins and password sessions → /denied; superadmins see every page; run API refuses non-superadmins and cross-site requests.");

  if (process.env.SCREENSHOTS) {
    const { chromium } = createRequire(import.meta.url)("playwright");
    const browser = await chromium.launch();
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
      const [name, value] = cookie(OWNER).split(/=(.*)/s);
      await ctx.addCookies([{ name, value, domain: "127.0.0.1", path: "/" }]);
      const page = await ctx.newPage();
      for (const [label, path] of [["dashboard", "/"], ["list", "/chains"], ["editor", `/chains/${CHAIN}`], ["run", `/chains/${CHAIN}/run`], ["media", `/chains/${CHAIN}/media`], ["history", `/chains/${CHAIN}/history`], ["detail", `/runs/${RUN}`], ["login", "/login"]]) {
        await page.goto(`${ORIGIN}${path}`);
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/${scheme}-${label}.png`, fullPage: true });
      }
      if (scheme === "light") {
        // Canvas: click a step → the side panel opens with its prompts; the preview marks placeholders.
        await page.goto(`${ORIGIN}/chains/${CHAIN}`);
        const node = (n) => page.locator(".react-flow__node-step").nth(n - 1);
        await node(2).locator(".cnode-title").click();
        const panel = page.locator(".chain-panel");
        await panel.getByRole("heading", { name: "Find the funny" }).waitFor();
        assert.equal(await panel.locator("select[name=llm_model_id]").count(), 0, "no model picker in the step editor");
        // Simple editor: fixed inputs (shown only), one Prompt, automatic output, Test output.
        const sections = await panel.locator(".panel-section-title").allTextContents();
        assert.deepEqual(sections, ["Basics", "Inputs", "Prompt", "Output"], "only these sections (plus Test output)");
        const inputs = await panel.locator(".io-list").textContent();
        for (const text of ["User prompt", "Image", "Step 1 output", "Describe the photo"]) assert.match(inputs, new RegExp(text), `inputs: ${text}`);
        assert.equal(await panel.getByRole("textbox", { name: "User prompt" }).count(), 0, "no user prompt to write");
        assert.equal(await panel.locator("select[name=output_kind]").count(), 0, "output is automatic");
        assert.equal(await panel.getByText("What the model receives").count(), 0, "generated input is not shown");
        assert.doesNotMatch(await panel.locator(".panel-body").textContent(), /\{(direction|previous|step\d)\}|\{…\}/, "no {…} notes");
        const promptBox = panel.getByRole("textbox", { name: "Prompt", exact: true });
        await promptBox.fill("From the photo description, list 5 comic angles.");
        await panel.getByText("Unsaved", { exact: true }).waitFor();
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/light-canvas-panel.png` });
        // Full screen: the whole Steps area (canvas + editor); Esc returns.
        await page.getByRole("button", { name: "⤢ Full screen" }).click();
        await page.locator(".canvas-wrap.is-fullscreen .chain-panel").waitFor();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/light-fullscreen.png` });
        await page.keyboard.press("Escape");
        await page.locator(".canvas-wrap:not(.is-fullscreen)").waitFor();
        await panel.getByRole("button", { name: "Expand the prompt" }).click();
        await page.getByRole("dialog", { name: "Prompt" }).waitFor();
        await page.getByRole("button", { name: "Done" }).click();
        writes.length = 0;
        await page.keyboard.press("Control+s");
        await panel.getByText("Step saved.").waitFor({ timeout: 10000 });
        const patch = writes.find((w) => w.method === "PATCH" && w.path.endsWith("humor_prompt_chain_steps") && "system_prompt" in (w.body ?? {}));
        assert.ok(patch && patch.body.system_prompt === "From the photo description, list 5 comic angles." && !("llm_model_id" in patch.body) && !("user_prompt" in patch.body), "saved the Prompt; inputs and model are not set by the form");
        // Switching steps with unsaved changes asks first.
        await promptBox.fill("Changed again");
        await page.getByRole("button", { name: "Fit" }).click();
        await page.waitForTimeout(300);
        page.once("dialog", (d) => d.dismiss());
        await node(1).locator(".cnode-title").click();
        await panel.getByRole("heading", { name: "Find the funny" }).waitFor();
        // Test this step from the node's ▶: prefilled from the latest run (no key here, so the provider error shows).
        await page.goto(`${ORIGIN}/chains/${CHAIN}`);
        await page.getByRole("button", { name: "Test step 2" }).click();
        const tryBox = page.locator(".chain-panel details.try");
        await tryBox.getByLabel(/User prompt/).waitFor();
        await tryBox.locator("textarea").first().waitFor();
        assert.match(await tryBox.locator("textarea").first().inputValue(), /asleep face-down/, "earlier output prefilled from the latest run");
        await tryBox.getByRole("button", { name: "Run this step" }).click();
        await tryBox.getByText(/GEMINI_API_KEY is not set/).waitFor({ timeout: 15000 });
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/light-try.png` });
        // "+" on an arrow inserts a step there: created, then moved into place in one reorder.
        await page.goto(`${ORIGIN}/chains/${CHAIN}`);
        await page.getByRole("button", { name: "Insert a step before step 2" }).click();
        await panel.getByRole("heading", { name: "New step 2" }).waitFor();
        // A new step in the middle reads the user prompt and step 1; its output is text.
        assert.match(await panel.locator(".io-list").textContent(), /Step 1 output/);
        assert.doesNotMatch(await panel.locator(".io-list").textContent(), /Step 2 output/);
        assert.match(await panel.getByRole("textbox", { name: "Prompt", exact: true }).getAttribute("placeholder"), /Example/);
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/light-new-step.png` });
        await panel.getByLabel("Step name").fill("Pick the best angle");
        await panel.getByRole("textbox", { name: "Prompt", exact: true }).fill("You are a comedy editor. Pick the best angle.");
        writes.length = 0;
        await panel.getByRole("button", { name: "Add step" }).click();
        await page.waitForFunction(() => !document.querySelector(".chain-panel"), null, { timeout: 10000 });
        const reorder = writes.find((w) => w.path.endsWith("humor_reorder_prompt_chain_steps"));
        assert.equal(reorder?.body.step_ids[1], "11111111-1111-4111-8111-100000000099", "the new step is moved to position 2");
        // Zoom from the toolbar.
        const zoomLabel = page.getByLabel("Zoom level");
        const before = await zoomLabel.textContent();
        await page.getByRole("button", { name: "Zoom out" }).click();
        await page.waitForFunction((b) => document.querySelector("[aria-label='Zoom level']")?.textContent !== b, before);
        // Model for every step and duplicate go through their actions.
        await page.goto(`${ORIGIN}/chains/${CHAIN}`);
        assert.equal(await page.locator("select[name=llm_model_id]").count(), 1, "the model is chosen once, in Chain settings");
        await page.locator(`#model-${CHAIN}`).selectOption({ label: "GPT-6 Astra · OpenAI" });
        await page.getByRole("button", { name: "Save settings" }).click();
        await page.getByText("Saved. Every step now uses GPT-6 Astra.").waitFor({ timeout: 10000 });
        await page.locator("summary", { hasText: "Duplicate" }).click();
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/light-settings.png` });
        await page.getByRole("button", { name: "Duplicate", exact: true }).click();
        await page.waitForURL(/\?copied=1/, { timeout: 10000 });
        await page.getByText("Copy created with all its steps").waitFor();
        await page.goto(`${ORIGIN}/chains/${CHAIN}/history`);
        page.once("dialog", (d) => d.accept());
        await page.getByRole("button", { name: "Restore" }).click();
        await page.getByText("Restored version 1; saved as version 3.").waitFor({ timeout: 10000 });
        // Only neighbours are connected (no {step1} arcs), and nodes show status and types.
        await page.goto(`${ORIGIN}/chains/${CHAIN}`);
        assert.equal(await page.locator(".react-flow__edge").count(), 4, "photo→1→2→3→captions");
        assert.equal(await page.locator(".cnode-status", { hasText: "Last run ✓" }).count(), 3);
        // Drag from step 3's output point to step 1's input point: step 1 runs right after step 3.
        await page.getByRole("button", { name: "Fit" }).click();
        await page.waitForTimeout(300);
        writes.length = 0;
        await page.locator(".react-flow__node-step").nth(2).locator(".react-flow__handle-right").dragTo(page.locator(".react-flow__node-step").nth(0).locator(".react-flow__handle-left"));
        await page.getByText("Order saved.").waitFor({ timeout: 10000 });
        const dragged = writes.find((w) => w.path.endsWith("humor_reorder_prompt_chain_steps"));
        assert.deepEqual(dragged?.body.step_ids, [steps[1].id, steps[2].id, steps[0].id], "dragging output → input reorders");
        // Reorder from a step's ⋯ menu.
        await page.goto(`${ORIGIN}/chains/${CHAIN}`);
        await page.getByRole("button", { name: "Step 1 menu" }).click();
        await page.getByRole("menuitem", { name: "Move step 1 right" }).click();
        await page.getByText("Order saved.").waitFor({ timeout: 10000 });
        // Theme toggle: Dark is remembered and applied before paint on the next page.
        await page.getByRole("button", { name: /Account menu/ }).click();
        await page.getByRole("region", { name: "Account" }).waitFor();
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/light-menu.png` });
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("region", { name: "Account" }).count(), 0, "Escape closes the menu");
        await page.getByRole("button", { name: /Account menu/ }).click();
        await page.getByRole("button", { name: "Dark" }).click();
        await page.goto(`${ORIGIN}/`);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
        await page.getByRole("button", { name: /Account menu/ }).click();
        await page.getByRole("button", { name: "System" }).click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme ?? null), null);
      }
      if (scheme === "dark") {
        // Phone width: the step editor covers the screen.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${ORIGIN}/chains/${CHAIN}`);
        await page.locator(".react-flow__node-step").first().locator(".cnode-title").click();
        await page.locator(".chain-panel").waitFor();
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/dark-phone-panel.png` });
      }
      await ctx.close();
    }
    await browser.close();
    console.log("Screenshots saved.");
  }
} finally {
  process.kill(-app.pid); supa.close();
}

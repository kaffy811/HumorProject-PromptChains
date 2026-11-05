// Provider connectors for one prompt-chain step: prompts (+ optional photo) in,
// text out. Steps whose output_kind is "captions" ask for JSON and are parsed
// with parseCaptions. Pure apart from the injected fetch, so unit-tested offline.

export type StepCall = {
  provider: string; model: string; systemPrompt: string; userPrompt: string;
  image: { base64: string; mime: string } | null;
  json: boolean; schema: object | null;
  maxOutputTokens: number | null; temperature: number | null;
};
export type Usage = { input: number; output: number; total: number };
export type StepResult = { ok: true; text: string; usage: Usage } | { ok: false; error: string; usage: Usage };
export type Caption = { caption: string; style: string };
type Fetch = typeof fetch;

// Which environment variable holds each provider's key. Keys stay server-side.
export const PROVIDER_KEYS: Record<string, string> = { google: "GEMINI_API_KEY", openai: "OPENAI_API_KEY" };
export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_KEYS);
const TIMEOUT_MS = 50_000;
const NONE: Usage = { input: 0, output: 0, total: 0 };

export async function callStep(input: StepCall, env: Record<string, string | undefined>, fetcher: Fetch = fetch): Promise<StepResult> {
  const keyName = PROVIDER_KEYS[input.provider];
  if (!keyName) return { ok: false, error: `No connector for provider "${input.provider}". Supported: ${SUPPORTED_PROVIDERS.join(", ")}.`, usage: NONE };
  const key = env[keyName];
  if (!key) return { ok: false, error: `${keyName} is not set on this deployment.`, usage: NONE };
  try {
    const result = input.provider === "openai" ? await callOpenAI(input, key, fetcher) : await callGemini(input, key, fetcher);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 480) : "The provider call failed.", usage: NONE };
  }
}

async function callGemini(input: StepCall, key: string, fetcher: Fetch) {
  const config: Record<string, unknown> = {};
  if (input.json) config.responseMimeType = "application/json";
  if (input.json && input.schema) config.responseJsonSchema = input.schema;
  if (input.maxOutputTokens) config.maxOutputTokens = input.maxOutputTokens;
  if (input.temperature !== null) config.temperature = input.temperature;
  const parts: object[] = [{ text: input.userPrompt }];
  if (input.image) parts.push({ inlineData: { mimeType: input.image.mime, data: input.image.base64 } });
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: input.systemPrompt }] }, contents: [{ role: "user", parts }], generationConfig: config }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}: ${body?.error?.message ?? "no details"}`);
  if (body?.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request (${body.promptFeedback.blockReason}).`);
  const candidate = body?.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("").trim();
  if (!text) throw new Error(`Gemini returned no text (finish reason ${candidate?.finishReason ?? "unknown"}).`);
  const u = body.usageMetadata ?? {};
  return { text, usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), total: u.totalTokenCount ?? 0 } };
}

class SchemaRejected extends Error {}
async function callOpenAI(input: StepCall, key: string, fetcher: Fetch): Promise<{ text: string; usage: Usage }> {
  try {
    return await callOpenAIOnce(input, key, fetcher);
  } catch (error) {
    // Strict mode accepts only part of JSON Schema; fall back to plain JSON mode once.
    if (error instanceof SchemaRejected) return callOpenAIOnce({ ...input, schema: null }, key, fetcher);
    throw error;
  }
}

async function callOpenAIOnce(input: StepCall, key: string, fetcher: Fetch) {
  const content: object[] = [{ type: "text", text: input.userPrompt }];
  if (input.image) content.push({ type: "image_url", image_url: { url: `data:${input.image.mime};base64,${input.image.base64}` } });
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [{ role: "system", content: input.systemPrompt }, { role: "user", content }],
  };
  if (input.json) body.response_format = input.schema ? { type: "json_schema", json_schema: { name: "captions", strict: true, schema: input.schema } } : { type: "json_object" };
  if (input.maxOutputTokens) body.max_completion_tokens = input.maxOutputTokens;
  if (input.temperature !== null) body.temperature = input.temperature;
  const response = await fetcher("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = String(json?.error?.message ?? "no details");
    if (response.status === 400 && input.json && input.schema && /schema|response_format/i.test(detail)) throw new SchemaRejected(detail);
    throw new Error(`OpenAI returned HTTP ${response.status}: ${detail}`);
  }
  const message = json?.choices?.[0]?.message;
  if (message?.refusal) throw new Error(`OpenAI refused: ${message.refusal}`);
  const text = typeof message?.content === "string" ? message.content.trim() : "";
  if (!text) throw new Error(`OpenAI returned no text (finish reason ${json?.choices?.[0]?.finish_reason ?? "unknown"}).`);
  const u = json.usage ?? {};
  return { text, usage: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, total: u.total_tokens ?? 0 } };
}

// Final-step output: {"captions":[{caption, style}] } or {"captions":["..."]},
// tolerating code fences. Any number of captions (the example chain makes five).
export function parseCaptions(text: string): { ok: true; captions: Caption[] } | { ok: false; error: string } {
  let value: unknown;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return { ok: false, error: "The final step did not return valid JSON." }; }
  const list = Array.isArray(value) ? value : (value as { captions?: unknown })?.captions;
  if (!Array.isArray(list) || !list.length) return { ok: false, error: 'The final step returned no "captions" list.' };
  const captions = list.map((item) => {
    if (typeof item === "string") return { caption: item.trim(), style: "" };
    const c = (item ?? {}) as Record<string, unknown>;
    return { caption: String(c.caption ?? c.text ?? "").trim(), style: String(c.style ?? "").trim() };
  }).filter((c) => c.caption);
  if (!captions.length) return { ok: false, error: "The final step returned only empty captions." };
  return { ok: true, captions: captions.slice(0, 20) };
}

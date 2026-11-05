"use client";
import { useRef, useState } from "react";
import { fillPrompt, PLACEHOLDER } from "@/lib/chain-rules";
import type { ModelOption } from "@/lib/data";
import { estimateTokens } from "@/lib/flow";

export type StepInitial = {
  id: string; name: string; llm_model_id: string | null; include_image: boolean; output_kind: string;
  system_prompt: string; user_prompt: string; output_schema: unknown;
};

// Fields of one step (add and edit forms), with a live preview of the user
// prompt: placeholders highlighted (red when this step cannot use them) and
// filled with sample data, plus a rough token count.
export function StepFields({ chainId, models, initial, position }: { chainId: string; models: ModelOption[]; initial?: StepInitial; position: number }) {
  const [kind, setKind] = useState(initial?.output_kind ?? "text");
  const [system, setSystem] = useState(initial?.system_prompt ?? "");
  const [user, setUser] = useState(initial?.user_prompt ?? "");
  const [sees, setSees] = useState(initial ? initial.include_image : position === 1);
  const userBox = useRef<HTMLTextAreaElement>(null);
  const key = initial?.id ?? "new";
  const insert = (token: string) => {
    const box = userBox.current;
    const start = box?.selectionStart ?? user.length, end = box?.selectionEnd ?? user.length;
    setUser(user.slice(0, start) + token + user.slice(end));
    requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(start + token.length, start + token.length); });
  };
  const chips = ["{direction}", ...(position > 1 ? ["{previous}"] : []), ...Array.from({ length: position - 1 }, (_, i) => `{step${i + 1}}`)];
  return (
    <div className="form-grid">
      <input type="hidden" name="chain_id" value={chainId} />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="field">
        <label htmlFor={`sname-${key}`}>Step name</label>
        <input id={`sname-${key}`} name="name" className="input" required maxLength={80} defaultValue={initial?.name} placeholder="e.g. Describe the photo" />
      </div>
      <div className="field">
        <label htmlFor={`model-${key}`}>Model</label>
        <select id={`model-${key}`} name="llm_model_id" className="select" defaultValue={initial?.llm_model_id ?? ""}>
          <option value="">Choose a model…</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <span className="hint">Models and providers are managed in Humor Admin → LLM models &amp; providers.</span>
      </div>
      <div className="field">
        <span className="label">Input</span>
        <label className="check"><input type="checkbox" name="include_image" checked={sees} onChange={(e) => setSees(e.target.checked)} /> Sees the photo</label>
        <span className="hint">Step 1 usually does; later steps can work from earlier text only.</span>
      </div>
      <div className="field">
        <label htmlFor={`kind-${key}`}>Returns</label>
        <select id={`kind-${key}`} name="output_kind" className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="text">Text (passed to later steps)</option>
          <option value="captions">Captions (final JSON list)</option>
        </select>
      </div>
      <div className="field wide">
        <label htmlFor={`sys-${key}`}>System prompt</label>
        <textarea id={`sys-${key}`} name="system_prompt" className="textarea" required maxLength={20000} value={system} onChange={(e) => setSystem(e.target.value)} placeholder="Who the model is and the rules it follows." />
      </div>
      <div className="field wide">
        <label htmlFor={`user-${key}`}>User prompt</label>
        <textarea ref={userBox} id={`user-${key}`} name="user_prompt" className="textarea" required maxLength={4000} value={user} onChange={(e) => setUser(e.target.value)} placeholder="What to do with the photo and/or earlier output." />
        <div className="placeholders" aria-label="Insert a placeholder">
          {chips.map((c) => <button key={c} type="button" className="chip" onClick={() => insert(c)} title={chipHelp(c)}>{c}</button>)}
          <span className="hint">Click to insert at the cursor.</span>
        </div>
      </div>
      <PromptPreview template={user} system={system} position={position} sees={sees} />
      {kind === "captions" && (
        <div className="field wide">
          <label htmlFor={`schema-${key}`}>Output JSON schema <span className="muted">(optional)</span></label>
          <textarea id={`schema-${key}`} name="output_schema" className="textarea mono" maxLength={20000} rows={6}
            defaultValue={initial?.output_schema ? JSON.stringify(initial.output_schema, null, 2) : ""} placeholder='{"type":"object","properties":{"captions":{"type":"array"}}}' />
          <span className="hint">The model must return {"{\"captions\": [...]}"}; a schema makes it stricter.</span>
        </div>
      )}
    </div>
  );
}

function chipHelp(token: string) {
  if (token === "{direction}") return "The direction typed for the run (\"none\" when empty)";
  if (token === "{previous}") return "The output of the step right before this one";
  return `The output of step ${token.slice(5, -1)}`;
}

// The template with placeholders marked, and what it looks like filled in.
function PromptPreview({ template, system, position, sees }: { template: string; system: string; position: number; sees: boolean }) {
  if (!template.trim()) return null;
  const parts: { text: string; token?: { ok: boolean; why: string } }[] = [];
  let last = 0;
  for (const m of template.matchAll(new RegExp(PLACEHOLDER.source, "g"))) {
    if (m.index! > last) parts.push({ text: template.slice(last, m.index) });
    const step = m[2] ? Number(m[2]) : null;
    const ok = m[1] === "direction" || (m[1] === "previous" ? position > 1 : step !== null && step < position);
    parts.push({ text: m[0], token: { ok, why: ok ? chipHelp(m[0]) : m[1] === "previous" ? "Step 1 has no step before it" : `Step ${step} does not run before step ${position}` } });
    last = m.index! + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  const sample = fillPrompt(template, "midterms week", Array.from({ length: position - 1 }, (_, i) => `‹step ${i + 1} output›`));
  const tokens = estimateTokens(system) + estimateTokens(sample);
  return (
    <div className="field wide preview" aria-live="polite">
      <span className="label">Preview <span className="muted">· ≈ {tokens.toLocaleString("en-US")} tokens of prompt text{sees ? " + the photo" : ""}</span></span>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <pre className="prompt" aria-label="Template with placeholders">
          {parts.map((p, i) => p.token ? <mark key={i} className={p.token.ok ? "ph-ok" : "ph-bad"} title={p.token.why}>{p.text}</mark> : <span key={i}>{p.text}</span>)}
        </pre>
        <pre className="prompt" aria-label="Filled with sample data">{sample}</pre>
      </div>
      <span className="hint">Right: filled with the direction “midterms week” and placeholder outputs of earlier steps.</span>
    </div>
  );
}

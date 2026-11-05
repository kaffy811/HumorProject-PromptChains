"use client";
import { useState } from "react";
import type { ModelOption } from "@/lib/data";

export type StepInitial = {
  id: string; name: string; llm_model_id: string | null; include_image: boolean; output_kind: string;
  system_prompt: string; user_prompt: string; output_schema: unknown;
};
// Fields of one step (add and edit forms). The schema box only applies to captions.
export function StepFields({ chainId, models, initial, position }: { chainId: string; models: ModelOption[]; initial?: StepInitial; position: number }) {
  const [kind, setKind] = useState(initial?.output_kind ?? "text");
  const key = initial?.id ?? "new";
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
        <label className="check"><input type="checkbox" name="include_image" defaultChecked={initial ? initial.include_image : position === 1} /> Sees the photo</label>
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
        <textarea id={`sys-${key}`} name="system_prompt" className="textarea" required maxLength={20000} defaultValue={initial?.system_prompt} placeholder="Who the model is and the rules it follows." />
      </div>
      <div className="field wide">
        <label htmlFor={`user-${key}`}>User prompt</label>
        <textarea id={`user-${key}`} name="user_prompt" className="textarea" required maxLength={4000} defaultValue={initial?.user_prompt} placeholder="What to do with the photo and/or earlier output." />
        <div className="placeholders" aria-label="Placeholders">
          <code>{"{direction}"}</code><span className="hint">the run&apos;s direction</span>
          <code>{"{previous}"}</code><span className="hint">the step before&apos;s output</span>
          <code>{"{step1}"}</code><span className="hint">step 1&apos;s output (any earlier step number)</span>
        </div>
      </div>
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

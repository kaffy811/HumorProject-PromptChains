"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createStep, deleteStep, updateStep } from "@/lib/actions";
import { stepKind, stepTemplate, type Problem } from "@/lib/chain-rules";
import type { ModelOption } from "@/lib/data";
import { estimateTokens } from "@/lib/flow";
import { StepTry, type RunSample } from "@/components/StepTry";

export type PanelStep = {
  id: string; name: string; include_image: boolean; output_kind: string;
  system_prompt: string; user_prompt: string; output_schema: unknown;
};
const schemaText = (value: unknown) => (value ? JSON.stringify(value, null, 2) : "");

// The step editor beside the canvas, kept simple: Basics (name, sees the photo),
// Inputs (fixed, shown only: the member's input, the photo when ticked, every
// earlier step's output once), one Prompt, the Output (automatic: text passed
// on, or the captions for the last step) and Test output. The model is the
// chain's. Explicit save with an unsaved marker and Ctrl/⌘+S.
// step = null adds a step at insertAt.
export function StepPanel({ chainId, step, position, insertAt, total, model, before, problems, sample, onClose, onSaved, onDirty }: {
  chainId: string; step: PanelStep | null; position: number; insertAt: number | null;
  // How many steps the chain has with this one in it (decides whether it is the last).
  total: number; model: ModelOption | null;
  before: { name: string; output_kind: string }[];
  problems: Problem[]; sample: RunSample | null; onClose: () => void; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void;
}) {
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const tryBox = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(step?.name ?? "");
  const [sees, setSees] = useState(step ? step.include_image : position === 1);
  const [system, setSystem] = useState(step?.system_prompt ?? "");
  const [schema, setSchema] = useState(schemaText(step?.output_schema));
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const kind = stepKind(position, total);
  const template = stepTemplate(position, before.map((b) => b.name));
  const dirty = !step
    ? !!(name || system)
    : name !== step.name || sees !== step.include_image || system !== step.system_prompt || (kind === "captions" && schema !== schemaText(step.output_schema));
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  // A closed panel has nothing unsaved.
  useEffect(() => () => onDirty(false), [onDirty]);

  const save = () => {
    if (!form.current || pending) return;
    if (!form.current.reportValidity()) return;
    const data = new FormData(form.current);
    setMessage(null);
    start(async () => {
      const result = step ? await updateStep(null, data) : await createStep(null, data);
      if (result?.error) setMessage({ kind: "bad", text: result.error });
      else { setMessage({ kind: "good", text: result?.ok ?? "Saved." }); onSaved(result?.id ?? step!.id); }
    });
  };
  // Ctrl/⌘+S saves the open step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (dirty) save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const remove = () => {
    if (!step || !window.confirm(`Delete step ${position} “${step.name}”? Later steps move up. This cannot be undone.`)) return;
    const data = new FormData();
    data.set("chain_id", chainId); data.set("id", step.id);
    start(async () => {
      const result = await deleteStep(null, data);
      if (result?.error) setMessage({ kind: "bad", text: result.error });
      else { onDirty(false); onClose(); }
    });
  };
  const openTest = () => {
    const details = tryBox.current?.querySelector("details");
    if (details) details.open = true;
    tryBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <header className="panel-head">
        <span className="step-num" aria-hidden="true">{position}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{step ? name || "Untitled step" : `New step ${position}`}</h3>
          <span className="hint">{model ? model.label : "No model yet"} · {kind === "captions" ? "returns the captions" : "returns text"}</span>
        </div>
        {dirty && <span className="badge badge-warn">Unsaved</span>}
        {step && <button type="button" className="btn btn-icon" title="Test this step" aria-label="Test this step" onClick={openTest}>▶</button>}
        <button type="button" className="btn btn-icon" title="Close" aria-label="Close the step editor" onClick={onClose}>✕</button>
      </header>
      <div className="panel-body">
        {problems.map((p) => <div key={p.message} className={`notice notice-${p.blocking ? "bad" : "warn"}`}>{p.message}</div>)}
        <form id={formId} ref={form} className="stack-sm" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input type="hidden" name="chain_id" value={chainId} />
          {step && <input type="hidden" name="id" value={step.id} />}
          {insertAt && <input type="hidden" name="insert_at" value={insertAt} />}
          {/* Generated, not edited: the server regenerates them for the step's position on every save. */}
          <input type="hidden" name="user_prompt" value={template} />
          <input type="hidden" name="output_kind" value={kind} />
          {/* Sent only for "Test this step"; saving never changes a step's model. */}
          <input type="hidden" name="llm_model_id" value={model?.id ?? ""} />
          <Section title="Basics">
            <div className="field">
              <label htmlFor={`${formId}-name`}>Step name</label>
              <input id={`${formId}-name`} name="name" className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Look at the photo" />
            </div>
            <label className="check"><input type="checkbox" name="include_image" checked={sees} onChange={(e) => setSees(e.target.checked)} /> Sees the photo</label>
            <span className="hint">Model: {model ? model.label : "not chosen yet"} (set for the whole chain in <a href="#settings">Chain settings</a>).</span>
          </Section>
          <Section title="Inputs" hint="fixed · sent to the model automatically">
            <ul className="io-list">
              <li><span className="io-tag">User prompt</span><span className="type">String</span><span className="hint">What the member types (&quot;none&quot; when empty)</span></li>
              <li className={sees ? "" : "is-off"}><span className="io-tag">Image</span><span className="type">Image</span><span className="hint">{sees ? "The photo is attached" : "Not attached: tick Sees the photo in Basics"}</span></li>
              {before.map((b, i) => (
                <li key={i}><span className="io-tag">{`Step ${i + 1} output`}</span><span className="type">{b.output_kind === "captions" ? "JSON" : "String"}</span><span className="hint">{b.name}</span></li>
              ))}
            </ul>
            <details>
              <summary className="hint" style={{ cursor: "pointer" }}>What the model receives</summary>
              <pre className="prompt" aria-label="Generated input">{template}</pre>
            </details>
          </Section>
          <Section title="Prompt" action={<button type="button" className="btn btn-icon" aria-label="Expand the prompt" title="Expand" onClick={() => setExpanded(true)}>⤢</button>}>
            <textarea name="system_prompt" className="textarea" aria-label="Prompt" required maxLength={20000} rows={10} value={system} onChange={(e) => setSystem(e.target.value)}
              placeholder={position === 1
                ? "What this step should do with the photo and the member's input.\n\nExample:\nYou describe photos for a comedy writer. In 3 to 5 sentences, say who or what is in it, where it is and anything odd. If the user input is not \"none\", mention what relates to it."
                : "What this step should do with the inputs above.\n\nExample:\nFrom the photo description, list 5 comic angles, one short line each. If the user input is not \"none\", every angle must center on it."} />
            <span className="hint">≈ {(estimateTokens(system) + estimateTokens(template)).toLocaleString("en-US")} tokens of text{sees ? " + the photo" : ""}. The inputs are added after it automatically; no {"{…}"} needed.</span>
          </Section>
          <Section title="Output">
            {kind === "captions" ? (
              <>
                <p style={{ margin: 0 }}><span className="io-tag">Captions</span> <span className="type">JSON</span> <span className="hint">The last step returns the four captions, e.g. {"{\"captions\": [{\"caption\": \"…\", \"style\": \"deadpan\"}]}"}.</span></p>
                <details>
                  <summary className="hint" style={{ cursor: "pointer" }}>Advanced: JSON schema (optional)</summary>
                  <textarea name="output_schema" className="textarea mono" aria-label="Output JSON schema" rows={6} maxLength={20000} value={schema} onChange={(e) => setSchema(e.target.value)}
                    placeholder='{"type":"object","properties":{"captions":{"type":"array"}}}' style={{ marginTop: 8 }} />
                </details>
              </>
            ) : <p style={{ margin: 0 }}><span className="io-tag">{`Step ${position} output`}</span> <span className="type">String</span> <span className="hint">Text passed to every later step.</span></p>}
          </Section>
          {step && <div ref={tryBox}><StepTry position={position} template={template} sees={sees} sample={sample} /></div>}
        </form>
        {expanded && (
          <div className="prompt-modal" role="dialog" aria-modal="true" aria-label="Prompt" onKeyDown={(e) => { if (e.key === "Escape") setExpanded(false); }}>
            <div className="prompt-modal-box card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>Prompt · step {position}</h3>
                <button type="button" className="btn btn-sm" onClick={() => setExpanded(false)}>Done</button>
              </div>
              <textarea autoFocus className="textarea" value={system} onChange={(e) => setSystem(e.target.value)} />
            </div>
          </div>
        )}
      </div>
      <footer className="panel-foot">
        {message && <div className={`notice notice-${message.kind}`} role={message.kind === "bad" ? "alert" : "status"}>{message.text}</div>}
        <div className="row">
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending || !dirty}>{pending ? "Saving…" : step ? "Save step" : "Add step"}</button>
          <span className="hint">Ctrl/⌘+S</span>
          {step && <button type="button" className="btn btn-danger" style={{ marginLeft: "auto" }} disabled={pending} onClick={remove}>Delete step</button>}
        </div>
      </footer>
    </>
  );
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="panel-section" open>
      <summary>
        <span className="panel-section-title">{title}</span>
        {hint && <span className="hint">{hint}</span>}
        {action && <span style={{ marginLeft: "auto" }} onClick={(e) => e.preventDefault()}>{action}</span>}
      </summary>
      <div className="panel-section-body">{children}</div>
    </details>
  );
}

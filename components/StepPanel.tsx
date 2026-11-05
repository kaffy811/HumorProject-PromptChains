"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createStep, deleteStep, updateStep } from "@/lib/actions";
import { availableInputs } from "@/lib/canvas";
import type { Problem } from "@/lib/chain-rules";
import type { ModelOption } from "@/lib/data";
import { PromptPreview } from "@/components/PromptPreview";
import { StepTry, type RunSample } from "@/components/StepTry";

export type PanelStep = {
  id: string; name: string; include_image: boolean; output_kind: string;
  system_prompt: string; user_prompt: string; output_schema: unknown;
};
const schemaText = (value: unknown) => (value ? JSON.stringify(value, null, 2) : "");

// The step editor beside the canvas: collapsible sections, the chain's model
// shown (never chosen here), explicit save with an unsaved-changes marker and
// Ctrl/⌘+S, and "Test this step". step = null adds a step at insertAt.
export function StepPanel({ chainId, step, position, insertAt, model, names, problems, sample, onClose, onSaved, onDirty }: {
  chainId: string; step: PanelStep | null; position: number; insertAt: number | null; model: ModelOption | null; names: string[];
  problems: Problem[]; sample: RunSample | null; onClose: () => void; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void;
}) {
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const userBox = useRef<HTMLTextAreaElement>(null);
  const tryBox = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(step?.name ?? "");
  const [sees, setSees] = useState(step ? step.include_image : position === 1);
  const [kind, setKind] = useState(step?.output_kind ?? "text");
  const [system, setSystem] = useState(step?.system_prompt ?? "");
  const [user, setUser] = useState(step?.user_prompt ?? "");
  const [schema, setSchema] = useState(schemaText(step?.output_schema));
  const [expanded, setExpanded] = useState<"system" | "user" | null>(null);
  const [message, setMessage] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = !step
    ? !!(name || system || user)
    : name !== step.name || sees !== step.include_image || kind !== step.output_kind || system !== step.system_prompt || user !== step.user_prompt || (kind === "captions" && schema !== schemaText(step.output_schema));
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
  const insert = (token: string) => {
    const box = userBox.current;
    const from = box?.selectionStart ?? user.length, to = box?.selectionEnd ?? user.length;
    setUser(user.slice(0, from) + token + user.slice(to));
    requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(from + token.length, from + token.length); });
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
          <span className="hint">{model ? model.label : "No model yet"} · {kind === "captions" ? "returns captions" : "returns text"}</span>
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
          {/* Sent only for "Test this step"; saving never changes a step's model. */}
          <input type="hidden" name="llm_model_id" value={model?.id ?? ""} />
          <Section title="Basics">
            <div className="field">
              <label htmlFor={`${formId}-name`}>Step name</label>
              <input id={`${formId}-name`} name="name" className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Look at the photo" />
            </div>
            <div className="field">
              <span className="label">Model</span>
              <p className="model-note">{model ? model.label : "Not chosen yet"} <span className="hint">· set for the whole chain in <a href="#settings">Chain settings</a></span></p>
            </div>
            <div className="row" style={{ gap: 18 }}>
              <label className="check"><input type="checkbox" name="include_image" checked={sees} onChange={(e) => setSees(e.target.checked)} /> Sees the photo</label>
              <label className="check" htmlFor={`${formId}-kind`}>Returns
                <select id={`${formId}-kind`} name="output_kind" className="select" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: "auto" }}>
                  <option value="text">Text (passed on)</option>
                  <option value="captions">Captions (final JSON)</option>
                </select>
              </label>
            </div>
          </Section>
          <Section title="Inputs" hint="click to insert into the user prompt">
            <ul className="inputs">
              {sees && <li><span className="chip chip-static">photo</span><span className="hint">The run&apos;s photo is attached to this step</span></li>}
              {availableInputs(position, names).map((i) => (
                <li key={i.token}>
                  <button type="button" className="chip" onClick={() => insert(i.token)} title={`Insert ${i.token}`}>{i.token}</button>
                  <span className="hint">{i.help}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="System prompt" action={<button type="button" className="btn btn-icon" aria-label="Expand the system prompt" title="Expand" onClick={() => setExpanded("system")}>⤢</button>}>
            <textarea name="system_prompt" className="textarea" aria-label="System prompt" required maxLength={20000} rows={8} value={system} onChange={(e) => setSystem(e.target.value)} placeholder="Who the model is and the rules it follows." />
          </Section>
          <Section title="User prompt" action={<button type="button" className="btn btn-icon" aria-label="Expand the user prompt" title="Expand" onClick={() => setExpanded("user")}>⤢</button>}>
            <textarea ref={userBox} name="user_prompt" className="textarea" aria-label="User prompt" required maxLength={4000} rows={7} value={user} onChange={(e) => setUser(e.target.value)} placeholder="What to do with the photo and/or earlier output." />
            <PromptPreview template={user} system={system} position={position} sees={sees} />
          </Section>
          <Section title="Output">
            {kind === "captions" ? (
              <div className="field">
                <label htmlFor={`${formId}-schema`}>JSON schema <span className="muted">(optional)</span></label>
                <textarea id={`${formId}-schema`} name="output_schema" className="textarea mono" rows={6} maxLength={20000} value={schema} onChange={(e) => setSchema(e.target.value)} placeholder='{"type":"object","properties":{"captions":{"type":"array"}}}' />
                <span className="hint">The model must return {"{\"captions\": [...]}"}; a schema makes it stricter.</span>
              </div>
            ) : <p className="hint" style={{ margin: 0 }}>Plain text. Later steps read it as <span className="mono">{"{previous}"}</span> (the next step) or <span className="mono">{`{step${position}}`}</span>.</p>}
          </Section>
          {step && <div ref={tryBox}><StepTry position={position} template={user} sees={sees} sample={sample} /></div>}
        </form>
        {expanded && (
          <div className="prompt-modal" role="dialog" aria-modal="true" aria-label={expanded === "system" ? "System prompt" : "User prompt"}
            onKeyDown={(e) => { if (e.key === "Escape") setExpanded(null); }}>
            <div className="prompt-modal-box card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>{expanded === "system" ? "System prompt" : "User prompt"} · step {position}</h3>
                <button type="button" className="btn btn-sm" onClick={() => setExpanded(null)}>Done</button>
              </div>
              <textarea autoFocus className="textarea" value={expanded === "system" ? system : user}
                onChange={(e) => (expanded === "system" ? setSystem : setUser)(e.target.value)} />
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

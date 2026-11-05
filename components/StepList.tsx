"use client";
import { useState, useTransition } from "react";
import { deleteStep, reorderSteps, updateStep } from "@/lib/actions";
import { chainProblems, moveStep } from "@/lib/chain-rules";
import type { ModelOption } from "@/lib/data";
import { ActionForm } from "@/components/ActionForm";
import { StepFields, type StepInitial } from "@/components/StepFields";
import type { RunSample } from "@/components/StepTry";
import { FlowDiagram } from "@/components/FlowDiagram";

export type ListStep = StepInitial & { modelLabel: string | null; model: { model_id: string; is_active: boolean; supports_vision: boolean; provider: string | null } | null };

// Steps in run order. Reorder with ↑/↓ (works everywhere, keyboard included) or
// by dragging the handle; the new order shows at once, is saved atomically and
// rolls back if the save fails. Problems are recomputed for the new order.
export function StepList({ chainId, steps, models, supported, sample = null }: { chainId: string; steps: ListStep[]; models: ModelOption[]; supported: string[]; sample?: RunSample | null }) {
  const [order, setOrder] = useState(() => steps.map((s) => s.id));
  const [synced, setSynced] = useState(steps);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  // New steps from the server (add, delete, edit) replace the local order.
  if (synced !== steps) { setSynced(steps); setOrder(steps.map((s) => s.id)); }
  const byId = new Map(steps.map((s) => [s.id, s]));
  const ordered = order.map((id) => byId.get(id)).filter((s): s is ListStep => !!s);
  const problems = chainProblems(ordered.map((s, i) => ({ ...s, position: i + 1 })), supported);

  const save = (next: string[]) => {
    const previous = order;
    setOrder(next);
    setMessage(null);
    startSaving(async () => {
      const result = await reorderSteps(chainId, next);
      if (result?.error) { setOrder(previous); setMessage({ kind: "bad", text: result.error }); }
      else setMessage({ kind: "good", text: "Order saved." });
    });
  };
  const move = (from: number, to: number) => { const next = moveStep(order, from, to); if (next !== order) save(next); };

  if (!ordered.length) return <p className="empty">No steps yet. Add the first one below.</p>;
  return (
    <div className="stack-sm">
      <div aria-live="polite">
        {saving && <div className="notice">Saving order…</div>}
        {!saving && message && <div className={`notice notice-${message.kind}`} role={message.kind === "bad" ? "alert" : "status"}>{message.text}</div>}
      </div>
      <FlowDiagram steps={ordered.map((s) => ({ name: s.name, provider: s.model?.provider ?? null, include_image: s.include_image, user_prompt: s.user_prompt, output_kind: s.output_kind }))} />
      {problems.filter((p) => p.position === null).map((p) => (
        <div key={p.message} className={`notice notice-${p.blocking ? "bad" : "warn"}`}>{p.message}</div>
      ))}
      <ol className="steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {ordered.map((step, index) => {
          const n = index + 1;
          const own = problems.filter((p) => p.position === n);
          return (
            <li key={step.id} className="step" data-dragging={dragging === index} data-over={over === index && dragging !== index}
              onDragOver={(e) => { if (dragging !== null) { e.preventDefault(); setOver(index); } }}
              onDragLeave={() => setOver((o) => (o === index ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (dragging !== null) move(dragging, index); setDragging(null); setOver(null); }}>
              <div className="step-rail">
                <span className="step-num" aria-label={`Step ${n}`}>{n}</span>
                <button type="button" className="btn btn-icon" aria-label={`Move step ${n} up`} disabled={index === 0 || saving} onClick={() => move(index, index - 1)}>↑</button>
                <span className="drag-handle" draggable aria-hidden="true" title="Drag to reorder"
                  onDragStart={(e) => { setDragging(index); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", step.id); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}>⠿</span>
                <button type="button" className="btn btn-icon" aria-label={`Move step ${n} down`} disabled={index === ordered.length - 1 || saving} onClick={() => move(index, index + 1)}>↓</button>
              </div>
              <div className="card flat stack-sm">
                <div className="step-head">
                  <b>{step.name}</b>
                  <span className="muted">{step.modelLabel ?? "No model"}</span>
                  {step.include_image && <span className="badge">Sees photo</span>}
                  <span className={`badge ${step.output_kind === "captions" ? "badge-brand" : ""}`}>{step.output_kind === "captions" ? "Returns captions" : "Returns text"}</span>
                </div>
                {own.map((p) => <div key={p.message} className={`notice notice-${p.blocking ? "bad" : "warn"}`}>{p.message}</div>)}
                <details>
                  <summary>Prompts</summary>
                  <div className="grid grid-2" style={{ marginTop: 10, gap: 12 }}>
                    <div><span className="eyebrow">System</span><pre className="prompt">{step.system_prompt}</pre></div>
                    <div><span className="eyebrow">User</span><pre className="prompt">{step.user_prompt}</pre></div>
                  </div>
                </details>
                <details>
                  <summary>Edit step</summary>
                  <div style={{ marginTop: 12 }}>
                    <ActionForm action={updateStep} submit="Save step">
                      <StepFields chainId={chainId} models={models} initial={step} position={n} sample={sample} />
                    </ActionForm>
                  </div>
                </details>
                <ActionForm action={deleteStep} submit="Delete step" pendingLabel="Deleting…" danger className="row"
                  confirm={`Delete step ${n} “${step.name}”? Later steps move up. This cannot be undone.`}>
                  <input type="hidden" name="chain_id" value={chainId} />
                  <input type="hidden" name="id" value={step.id} />
                </ActionForm>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

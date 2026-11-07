"use client";
import { useRef, useState } from "react";
import { placeholdersIn } from "@/lib/chain-rules";
import type { TryResult } from "@/lib/try-step";
import { seconds } from "@/lib/format";

export type RunSample = { runId: string; direction: string; createdAt: string; outputs: (string | null)[]; statusByStep?: Record<string, string> };

// "Test this step": runs this one step exactly as the form shows it (saved or
// not) on a photo and hand-written earlier outputs. Nothing is saved.
export function StepTry({ position, template, sees, sample }: { position: number; template: string; sees: boolean; sample: RunSample | null }) {
  const box = useRef<HTMLDetailsElement>(null);
  // Earlier outputs this prompt actually uses ({previous} = the step right before).
  const needed = [...new Set(placeholdersIn(template).map((p) => (p.step === "previous" ? position - 1 : p.step)).filter((n): n is number => typeof n === "number" && n >= 1 && n < position))].sort((a, b) => a - b);
  const [samples, setSamples] = useState<Record<number, string>>(() => Object.fromEntries(Array.from({ length: position - 1 }, (_, i) => [i + 1, sample?.outputs[i] ?? ""])));
  const [direction, setDirection] = useState(sample?.direction ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usesRunPhoto = sees && !file && !!sample;

  async function run() {
    const form = box.current?.closest("form");
    if (!form) return;
    const data = new FormData(form);
    if (!String(data.get("name") ?? "").trim()) data.set("name", `Step ${position}`);
    data.set("position", String(position));
    data.set("direction", direction);
    for (const [n, text] of Object.entries(samples)) data.set(`sample_${n}`, text);
    if (file) data.set("image", file);
    else if (sample) data.set("sample_run", sample.runId);
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch("/api/steps/try", { method: "POST", body: data });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(body?.error ?? `Request failed (HTTP ${response.status}).`);
      else setResult(body as TryResult);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="field wide try" ref={box}>
      <summary><span className="label">▶ Test output</span> </summary>
      <div className="stack-sm" style={{ marginTop: 12 }}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor={`try-dir-${position}`}>User prompt <span className="muted">(optional)</span></label>
            <input id={`try-dir-${position}`} className="input" maxLength={120} value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="What a member would type, e.g. midterms week" />
          </div>
          {sees && (
            <div className="field">
              <label htmlFor={`try-photo-${position}`}>Photo</label>
              <input id={`try-photo-${position}`} type="file" className="input" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <span className="hint">{usesRunPhoto ? "Empty: uses the photo of this chain's latest run." : file ? file.name : "Choose a photo: this step sees it."}</span>
            </div>
          )}
          {needed.map((n) => (
            <div className="field wide" key={n}>
              <label htmlFor={`try-s${n}-${position}`}>{`Step ${n} output`}</label>
              <textarea id={`try-s${n}-${position}`} className="textarea" rows={4} maxLength={20000} value={samples[n] ?? ""} onChange={(e) => setSamples({ ...samples, [n]: e.target.value })}
                placeholder={`Paste or write what step ${n} would return.`} />
            </div>
          ))}
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={run} disabled={busy}>{busy ? "Running…" : "Run this step"}</button>
          {result && <span className="mono muted">{result.model} · {seconds(result.latencyMs)} · {result.usage.total.toLocaleString("en-US")} tokens</span>}
        </div>
        {error && <div className="notice notice-bad" role="alert">{error}</div>}
        {result && (
          <div className="stack-sm" aria-live="polite">
            {!result.ok && <div className="notice notice-bad" role="alert">{result.error}</div>}
            {result.captions && <ol className="captions">{result.captions.map((c, i) => <li key={i}>{c.caption}{c.style && <span className="badge" style={{ marginLeft: 8 }}>{c.style}</span>}</li>)}</ol>}
            {result.output && !result.captions && <><span className="label">Test output</span><pre className="prompt">{result.output}</pre></>}
            <details><summary className="hint" style={{ cursor: "pointer" }}>Prompt sent</summary><pre className="prompt">{result.prompt}</pre></details>
          </div>
        )}
      </div>
    </details>
  );
}

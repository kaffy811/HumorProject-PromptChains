"use client";
import Link from "next/link";
import { useState } from "react";

type Post = { id: string; content: string; url: string | null };
type StepView = { position: number; name: string; model: string | null; status: "pending" | "running" | "completed" | "failed"; output?: string | null; error?: string; latencyMs?: number; tokens?: number };
type Caption = { caption: string; style: string };

// Starts a run, then calls each step in turn so its output appears as soon as
// it is ready. A failed step can be retried without redoing earlier ones.
export function RunPanel({ chainId, posts, blocked }: { chainId: string; posts: Post[]; blocked: string[] }) {
  const [source, setSource] = useState<"upload" | "post">("upload");
  const [postId, setPostId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (position: number, change: Partial<StepView>) =>
    setSteps((list) => list.map((s) => (s.position === position ? { ...s, ...change } : s)));

  async function runFrom(id: string, list: StepView[], from: number) {
    for (const step of list.filter((s) => s.position >= from)) {
      patch(step.position, { status: "running", error: undefined });
      const res = await fetch(`/api/runs/${id}/steps/${step.position}`, { method: "POST" });
      const body = await res.json().catch(() => ({ error: "No response." }));
      if (!res.ok) { patch(step.position, { status: "failed", error: body.error }); return; }
      patch(step.position, { status: body.status, output: body.output, error: body.error, latencyMs: body.latencyMs, tokens: body.usage?.total });
      if (body.status === "failed") return;
      if (body.done && body.captions) setCaptions(body.captions);
    }
  }

  async function start(form: HTMLFormElement) {
    setBusy(true); setError(null); setCaptions(null); setRunId(null); setSteps([]);
    try {
      const data = new FormData(form);
      data.set("chain_id", chainId);
      if (source === "post") { data.delete("image"); data.set("caption_id", postId ?? ""); } else data.delete("caption_id");
      const res = await fetch("/api/runs", { method: "POST", body: data });
      const body = await res.json().catch(() => ({ error: "No response." }));
      if (!res.ok) { setError(body.error ?? "The run could not start."); return; }
      const list: StepView[] = body.steps.map((s: { position: number; name: string; model: string | null }) => ({ ...s, status: "pending" }));
      setRunId(body.runId); setSteps(list);
      await runFrom(body.runId, list, 1);
    } finally { setBusy(false); }
  }

  async function retry(position: number) {
    if (!runId) return;
    setBusy(true);
    try { await runFrom(runId, steps, position); } finally { setBusy(false); }
  }

  return (
    <section className="grid grid-2">
      <form className="card form" onSubmit={(e) => { e.preventDefault(); start(e.currentTarget); }}>
        <h2>Photo</h2>
        {blocked.length > 0 && <div className="notice notice-bad" role="alert">Fix the chain before running: {blocked.join(" ")} <Link href={`/chains/${chainId}`}>Edit steps →</Link></div>}
        <div className="row" role="radiogroup" aria-label="Photo source">
          <label className="check"><input type="radio" name="source" checked={source === "upload"} onChange={() => setSource("upload")} /> Upload a photo</label>
          <label className="check"><input type="radio" name="source" checked={source === "post"} onChange={() => setSource("post")} disabled={!posts.length} /> Use a member post</label>
        </div>
        {source === "upload" ? (
          <div className="field">
            <label htmlFor="image">Photo</label>
            <input id="image" name="image" type="file" required accept="image/jpeg,image/png,image/webp,image/gif" className="input"
              onChange={(e) => { const f = e.target.files?.[0]; setPreview((old) => { if (old) URL.revokeObjectURL(old); return f ? URL.createObjectURL(f) : null; }); }} />
            <span className="hint">JPG, PNG, WebP or GIF up to 4 MB. Stored privately with the run.</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            {preview && <img src={preview} alt="Selected photo" className="media-preview" style={{ maxHeight: 240 }} />}
          </div>
        ) : (
          <div className="gallery" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 10 }} role="radiogroup" aria-label="Member posts">
            {posts.map((p) => (
              <label key={p.id} title={p.content} style={{ cursor: "pointer", outline: postId === p.id ? "3px solid var(--tomato)" : undefined, outlineOffset: 2 }}>
                <input type="radio" name="post" value={p.id} checked={postId === p.id} onChange={() => setPostId(p.id)} style={{ position: "absolute", opacity: 0 }} aria-label={p.content} />
                {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                {p.url ? <img src={p.url} alt="" className="gallery-image" /> : <span className="gallery-image" />}
              </label>
            ))}
          </div>
        )}
        <div className="field">
          <label htmlFor="direction">Direction <span className="muted">(optional)</span></label>
          <input id="direction" name="direction" className="input" maxLength={120} placeholder="e.g. midterms week" />
          <span className="hint">Fills {"{direction}"} in the steps&apos; prompts.</span>
        </div>
        {error && <div className="notice notice-bad" role="alert">{error}</div>}
        <div><button className="btn btn-primary" type="submit" disabled={busy || blocked.length > 0 || (source === "post" && !postId)}>{busy ? "Running…" : "Generate"}</button></div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Each step is billed by its provider. Runs never create member posts.</p>
      </form>

      <div className="card" aria-live="polite">
        <h2>Steps</h2>
        {!steps.length && <p className="empty">Choose a photo and generate. Each step&apos;s output appears here as soon as it is ready.</p>}
        <div className="timeline">
          {steps.map((s) => (
            <div key={s.position} className="timeline-item" data-status={s.status}>
              <div className="row">
                <b>Step {s.position} · {s.name}</b>
                <span className={`badge ${s.status === "completed" ? "badge-good" : s.status === "failed" ? "badge-bad" : s.status === "running" ? "badge-brand" : ""}`}>{s.status === "running" ? "Running…" : s.status}</span>
                <span className="muted" style={{ fontSize: 12 }}>{s.model}{s.latencyMs !== undefined && ` · ${(s.latencyMs / 1000).toFixed(1)} s`}{s.tokens ? ` · ${s.tokens} tokens` : ""}</span>
              </div>
              {s.error && <div className="notice notice-bad">{s.error} <button type="button" className="btn btn-sm" onClick={() => retry(s.position)} disabled={busy}>Retry from here</button></div>}
              {s.output && <pre className="prompt">{s.output}</pre>}
            </div>
          ))}
        </div>
        {captions && (
          <div className="stack-sm" style={{ marginTop: 16 }}>
            <h2>Captions</h2>
            <ol className="captions">{captions.map((c, i) => <li key={i}>{c.caption}{c.style && <span className="badge" style={{ marginLeft: 8 }}>{c.style}</span>}</li>)}</ol>
          </div>
        )}
        {runId && !busy && steps.every((s) => s.status === "completed") && <p style={{ marginBottom: 0 }}><Link href={`/runs/${runId}`}>Open this run →</Link></p>}
      </div>
    </section>
  );
}

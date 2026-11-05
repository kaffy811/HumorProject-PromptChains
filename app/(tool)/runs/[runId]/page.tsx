import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";
import { UUID } from "@/lib/chain-rules";
import { signedUrls } from "@/lib/data";
import { RUN_BUCKET } from "@/lib/runs";
import { serviceClient } from "@/lib/supabase/service";
import { captionList, seconds, tokensOf, when } from "@/lib/format";
export const metadata: Metadata = { title: "Run" };

type Step = { position: number; name: string; provider: string; model: string; include_image: boolean; output_kind: string; status: string; user_prompt: string | null; user_prompt_template: string; system_prompt: string; output: string | null; error: string | null; usage: unknown; latency_ms: number | null };

// One run: the photo, every step's filled prompt and output, and the captions.
export default async function RunDetail({ params }: { params: Promise<{ runId: string }> }) {
  await requireSuperadmin();
  const { runId } = await params;
  if (!UUID.test(runId)) notFound();
  const db = serviceClient();
  const [{ data: run }, { data: steps }] = await Promise.all([
    db.from("humor_chain_runs").select("*").eq("id", runId).maybeSingle(),
    db.from("humor_chain_run_steps").select("*").eq("run_id", runId).order("position"),
  ]);
  if (!run) notFound();
  const rows = (steps ?? []) as Step[];
  const urls = await signedUrls(db, RUN_BUCKET, [run.image_path]);
  const caps = captionList(run.captions);
  const totalTokens = rows.reduce((sum, s) => sum + tokensOf(s.usage), 0);
  const totalMs = rows.reduce((sum, s) => sum + (s.latency_ms ?? 0), 0);
  return (
    <div className="stack">
      <div>
        {run.chain_id ? <Link href={`/chains/${run.chain_id}/media`} className="back">← {run.chain_name} · media</Link> : <Link href="/chains" className="back">← All prompt chains</Link>}
        <header className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <span className="eyebrow">Run · <span className="mono">{run.prompt_version}</span> · {when(run.created_at)}</span>
            <h1>{run.chain_name}</h1>
            <p><span className={`badge ${run.status === "completed" ? "badge-good" : run.status === "failed" ? "badge-bad" : "badge-warn"}`}>{run.status}</span> · {rows.length} steps · {totalTokens} tokens · {seconds(totalMs)}{!run.chain_id && " · chain since deleted"}</p>
          </div>
          {run.chain_id && <Link className="btn btn-primary" href={`/chains/${run.chain_id}/run`}>Generate again</Link>}
        </header>
      </div>
      <section className="grid grid-2">
        <div className="card stack-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
          {urls[run.image_path] ? <img src={urls[run.image_path]} alt="Run photo" className="media-preview" /> : <div className="empty">Photo unavailable.</div>}
          <dl className="kv"><dt>Direction</dt><dd>{run.direction ?? "none"}</dd></dl>
        </div>
        <div className="card">
          <h2>Result</h2>
          {caps.length ? <ol className="captions">{caps.map((c, i) => <li key={i}>{c.caption}{c.style && <span className="badge" style={{ marginLeft: 8 }}>{c.style}</span>}</li>)}</ol>
            : run.final_output ? <pre className="prompt">{run.final_output}</pre>
            : <p className="empty">{run.status === "failed" ? "The run stopped at a failed step." : "Not finished."}</p>}
        </div>
      </section>
      <section className="card">
        <h2>Steps</h2>
        <p className="sub">Each step&apos;s settings were copied when the run started, so later edits to the chain do not change this record.</p>
        <div className="timeline">
          {rows.map((s) => (
            <div key={s.position} className="timeline-item" data-status={s.status}>
              <div className="row">
                <b>Step {s.position} · {s.name}</b>
                <span className={`badge ${s.status === "completed" ? "badge-good" : s.status === "failed" ? "badge-bad" : ""}`}>{s.status}</span>
                <span className="muted" style={{ fontSize: 12 }}>{s.provider} · <span className="mono">{s.model}</span>{s.include_image ? " · sees photo" : ""} · returns {s.output_kind} · {seconds(s.latency_ms)} · {tokensOf(s.usage)} tokens</span>
              </div>
              {s.error && <div className="notice notice-bad">{s.error}</div>}
              <details><summary>Prompts sent</summary>
                <div className="grid grid-2" style={{ gap: 12, marginTop: 10 }}>
                  <div><span className="eyebrow">System</span><pre className="prompt">{s.system_prompt}</pre></div>
                  <div><span className="eyebrow">User</span><pre className="prompt">{s.user_prompt ?? s.user_prompt_template}</pre></div>
                </div>
              </details>
              {s.output && <pre className="prompt">{s.output}</pre>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

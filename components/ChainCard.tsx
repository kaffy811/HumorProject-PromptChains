import Link from "next/link";
import type { StepRow } from "@/lib/data";

// Short names for providers in badges; anything else shows its slug.
export const PROVIDER_LABELS: Record<string, string> = { google: "Gemini", openai: "GPT" };
export const providerLabel = (slug: string | null | undefined) => (slug ? PROVIDER_LABELS[slug] ?? slug : "No model");

type Chain = { id: string; name: string; prompt_version: string; description: string | null; share: number; steps: StepRow[]; runs: number };
// One chain at a glance: its steps as a small flow, use by members, runs. A chain
// is not tied to a provider (its model can be switched), so no Gemini/GPT badge.
export function ChainCard({ chain, blocking }: { chain: Chain; blocking: number }) {
  return (
    <article className="card chain-card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <Link href={`/chains/${chain.id}`} className="chain-card-title">{chain.name}</Link>
          <div className="mono muted">{chain.prompt_version}</div>
        </div>
      </div>
      <MiniFlow steps={chain.steps} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          {blocking ? <span className="badge badge-bad">{blocking} to fix</span> : <span className="badge badge-good">Ready to run</span>}
          {chain.share === 100 && <span className="badge badge-brand">Members use this</span>}
          <span className="muted" style={{ fontSize: 12 }}>{chain.runs} run{chain.runs === 1 ? "" : "s"}</span>
        </div>
        <div className="row">
          <Link className="btn btn-sm" href={`/chains/${chain.id}`}>Edit</Link>
          <Link className="btn btn-sm" href={`/chains/${chain.id}/media`}>Media</Link>
          <Link className="btn btn-sm btn-primary" href={`/chains/${chain.id}/run`}>Generate</Link>
        </div>
      </div>
    </article>
  );
}

// 📷 → ① Describe → ② Find the funny → ③ Captions; a step with no model is marked.
export function MiniFlow({ steps }: { steps: StepRow[] }) {
  if (!steps.length) return <p className="muted" style={{ margin: 0, fontSize: 13 }}>No steps yet.</p>;
  return (
    <ol className="mini-flow" aria-label="Steps">
      <li className="mini-node mini-photo" aria-label="Photo">📷</li>
      {steps.map((s, i) => (
        <li key={s.id} className={`mini-node${s.model ? "" : " no-model"}`} title={`${s.name} · ${s.modelLabel ?? "no model"}${s.include_image ? " · sees photo" : ""}`}>
          <b>{i + 1}</b> {s.name}{s.output_kind === "captions" && <span aria-label="returns captions"> ✦</span>}
        </li>
      ))}
    </ol>
  );
}

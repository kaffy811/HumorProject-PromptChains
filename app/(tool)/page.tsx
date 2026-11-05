import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperadmin } from "@/lib/auth";
import { createChain } from "@/lib/actions";
import { chainProblems } from "@/lib/chain-rules";
import { isMissingTable, listChains } from "@/lib/data";
import { SUPPORTED_PROVIDERS } from "@/lib/llm";
import { ActionForm } from "@/components/ActionForm";
import { ChainFields } from "@/components/ChainFields";
import { MigrationNotice } from "@/components/MigrationNotice";
export const metadata: Metadata = { title: "Prompt chains" };

export default async function Chains({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  await requireSuperadmin();
  const { deleted } = await searchParams;
  const { chains, error, runsReady } = await listChains();
  if (error && !isMissingTable(error)) throw new Error(error.message);
  return (
    <div className="stack">
      <header className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow">Create · read · update · delete</span>
          <h1>Prompt chains.</h1>
          <p>A chain is an ordered list of LLM steps that turns a photo into captions, e.g. describe the photo → find what is funny → write the captions. Open one to edit and reorder its steps, run it on a photo, or see what it has made.</p>
        </div>
      </header>
      {(error || !runsReady) && <MigrationNotice />}
      {deleted && <div className="notice notice-good" role="status">Prompt chain deleted. Its runs are kept.</div>}
      <details className="card" open={!chains.length}>
        <summary style={{ fontWeight: 800 }}>+ New prompt chain</summary>
        <div style={{ marginTop: 14 }}>
          <ActionForm action={createChain} submit="Create chain" pendingLabel="Creating…"><ChainFields /></ActionForm>
        </div>
      </details>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Chain</th><th>Steps</th><th>Models</th><th className="r">Runs</th><th>Status</th><th /></tr></thead>
          <tbody>
            {chains.map((c) => {
              const blocking = chainProblems(c.steps, SUPPORTED_PROVIDERS).filter((p) => p.blocking).length;
              const models = [...new Set(c.steps.map((s) => s.modelLabel ?? "No model"))];
              return (
                <tr key={c.id}>
                  <td><Link href={`/chains/${c.id}`} style={{ fontWeight: 800 }}>{c.name}</Link><br /><span className="mono muted">{c.prompt_version}</span></td>
                  <td>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{c.steps.map((s) => <li key={s.id}>{s.name}</li>)}</ol>
                    {!c.steps.length && <span className="muted">No steps</span>}
                  </td>
                  <td style={{ fontSize: 13 }}>{models.map((m) => <div key={m}>{m}</div>)}</td>
                  <td className="r num"><Link href={`/chains/${c.id}/media`}>{c.runs}</Link></td>
                  <td>
                    <div className="row">
                      {blocking ? <span className="badge badge-bad">{blocking} to fix</span> : <span className="badge badge-good">Ready to run</span>}
                      {c.share === 100 && <span className="badge badge-brand">Members</span>}
                    </div>
                  </td>
                  <td><div className="row" style={{ justifyContent: "flex-end" }}>
                    <Link className="btn btn-sm" href={`/chains/${c.id}`}>Edit</Link>
                    <Link className="btn btn-sm" href={`/chains/${c.id}/run`}>Run</Link>
                  </div></td>
                </tr>
              );
            })}
            {!chains.length && <tr><td colSpan={6} className="empty">No prompt chains yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

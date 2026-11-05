import type { Metadata } from "next";
import { requireSuperadmin } from "@/lib/auth";
import { createChain } from "@/lib/actions";
import { chainProblems } from "@/lib/chain-rules";
import { isMissingTable, listChains, modelOptions } from "@/lib/data";
import { SUPPORTED_PROVIDERS } from "@/lib/llm";
import { ActionForm } from "@/components/ActionForm";
import { ChainFields } from "@/components/ChainFields";
import { MigrationNotice } from "@/components/MigrationNotice";
import { ChainCard } from "@/components/ChainCard";
export const metadata: Metadata = { title: "Prompt chains" };

export default async function Chains({ searchParams }: { searchParams: Promise<{ deleted?: string; new?: string }> }) {
  await requireSuperadmin();
  const { deleted, new: opening } = await searchParams;
  const [{ chains, error, runsReady }, models] = await Promise.all([listChains(), modelOptions()]);
  if (error && !isMissingTable(error)) throw new Error(error.message);
  return (
    <div className="stack">
      <header className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow">Create · read · update · delete · {chains.length} chains</span>
          <h1>Prompt chains.</h1>
          <p>A chain is an ordered list of LLM steps that turns a photo into captions, e.g. describe the photo → find what is funny → write the captions. Open one to edit and reorder its steps, run it on a photo, or see what it has made.</p>
        </div>
      </header>
      {(error || !runsReady) && <MigrationNotice />}
      {deleted && <div className="notice notice-good" role="status">Prompt chain deleted. Its runs are kept.</div>}
      <details className="card" id="new" open={!chains.length || !!opening}>
        <summary style={{ fontWeight: 800 }}>+ New prompt chain</summary>
        <div style={{ marginTop: 14 }}>
          <ActionForm action={createChain} submit="Create chain" pendingLabel="Creating…"><ChainFields models={models} /></ActionForm>
        </div>
      </details>
      <div className="chain-grid">
        {chains.map((c) => <ChainCard key={c.id} chain={c} blocking={chainProblems(c.steps, SUPPORTED_PROVIDERS).filter((p) => p.blocking).length} />)}
      </div>
      {!chains.length && <p className="card flat empty">No prompt chains yet. Create the first one above.</p>}
    </div>
  );
}

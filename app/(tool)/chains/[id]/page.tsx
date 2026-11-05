import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";
import { createStep, deleteChain, updateChain } from "@/lib/actions";
import { getChain, modelOptions } from "@/lib/data";
import { MAX_STEPS } from "@/lib/chain-rules";
import { SUPPORTED_PROVIDERS } from "@/lib/llm";
import { ActionForm } from "@/components/ActionForm";
import { ChainFields } from "@/components/ChainFields";
import { StepFields } from "@/components/StepFields";
import { StepList } from "@/components/StepList";
export const metadata: Metadata = { title: "Edit chain" };

export default async function EditChain({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await requireSuperadmin();
  const { id } = await params;
  const { created } = await searchParams;
  const [found, models] = await Promise.all([getChain(id), modelOptions()]);
  if (!found) notFound();
  const { chain, steps } = found;
  return (
    <div className="stack">
      {created && <div className="notice notice-good" role="status">Chain created. Add its steps below.</div>}
      <section className="card">
        <h2>Steps</h2>
        <p className="sub">They run top to bottom. Step 1 usually sees the photo; later steps use earlier output through <span className="mono">{"{previous}"}</span> or <span className="mono">{"{stepN}"}</span>. Reorder with ↑ ↓ or drag the ⠿ handle; the order is saved immediately.</p>
        <StepList chainId={chain.id} steps={steps} models={models} supported={SUPPORTED_PROVIDERS} />
      </section>
      <details className="card" open={!steps.length}>
        <summary style={{ fontWeight: 800 }}>+ Add step {steps.length + 1}</summary>
        <div style={{ marginTop: 14 }}>
          {steps.length >= MAX_STEPS ? <p className="empty">A chain can have at most {MAX_STEPS} steps.</p> : (
            <ActionForm action={createStep} submit="Add step" pendingLabel="Adding…" resetOnOk>
              <StepFields chainId={chain.id} models={models} position={steps.length + 1} />
            </ActionForm>
          )}
        </div>
      </details>
      <section className="grid grid-2">
        <div className="card">
          <h2>Chain details</h2>
          <p className="sub">Name, prompt version and description.</p>
          <ActionForm action={updateChain} submit="Save chain"><ChainFields initial={chain} /></ActionForm>
        </div>
        <div className="card" style={{ alignSelf: "start" }}>
          <h2>Delete chain</h2>
          <p className="sub">Removes the chain and its steps. Media it already generated stays under its name and version.{chain.share ? " Members are using this chain: choose another model for members in Humor Admin first." : ""}</p>
          <ActionForm action={deleteChain} submit="Delete chain" pendingLabel="Deleting…" danger className="form"
            confirm={`Delete “${chain.name}” and all its steps? This cannot be undone.`}>
            <input type="hidden" name="id" value={chain.id} />
          </ActionForm>
        </div>
      </section>
    </div>
  );
}

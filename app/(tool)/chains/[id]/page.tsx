import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";
import { createStep, deleteChain, duplicateChain, updateChain } from "@/lib/actions";
import { copySuggestion, getChain, latestRunSample, modelOptions } from "@/lib/data";
import { MAX_STEPS } from "@/lib/chain-rules";
import { SUPPORTED_PROVIDERS } from "@/lib/llm";
import { ActionForm } from "@/components/ActionForm";
import { ChainFields } from "@/components/ChainFields";
import { StepFields } from "@/components/StepFields";
import { StepList } from "@/components/StepList";
export const metadata: Metadata = { title: "Edit chain" };

export default async function EditChain({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; copied?: string }> }) {
  await requireSuperadmin();
  const { id } = await params;
  const { created, copied } = await searchParams;
  const [found, models, sample] = await Promise.all([getChain(id), modelOptions(), latestRunSample(id).catch(() => null)]);
  if (!found) notFound();
  const { chain, steps } = found;
  const copy = await copySuggestion(chain.name, chain.prompt_version);
  const model = models.find((m) => m.id === chain.llm_model_id) ?? null;
  const seeing = steps.some((s) => s.include_image);
  const usedModels = new Set(steps.map((s) => s.llm_model_id ?? "none")).size;
  return (
    <div className="stack">
      {created && <div className="notice notice-good" role="status">Chain created. {model ? "Add its steps below." : "Choose its model, then add its steps."}</div>}
      {copied && <div className="notice notice-good" role="status">Copy created with all its steps. Members are not using it; its history starts here.</div>}
      <section className="card" id="settings">
        <div className="card-head">
          <div>
            <h2>Chain settings</h2>
            <p className="sub" style={{ margin: 0 }}>Name, prompt version, description and the model every step uses.</p>
          </div>
          <div className="row">
            <Link className="btn btn-sm" href={`/chains/${chain.id}/history`}>⟲ History</Link>
            <details className="popover">
              <summary className="btn btn-sm">⧉ Duplicate</summary>
              <div className="popover-panel card">
                <p className="sub" style={{ marginTop: 0 }}>Copies the chain, its model and its {steps.length} step{steps.length === 1 ? "" : "s"} under a new prompt version. Members do not get the copy.</p>
                <ActionForm action={duplicateChain} submit="Duplicate" pendingLabel="Copying…" className="form">
                  <input type="hidden" name="id" value={chain.id} />
                  <div className="field">
                    <label htmlFor="copy-name">Name</label>
                    <input id="copy-name" name="name" className="input" required maxLength={80} defaultValue={copy.name} />
                  </div>
                  <div className="field">
                    <label htmlFor="copy-version">Prompt version</label>
                    <input id="copy-version" name="prompt_version" className="input mono" required maxLength={60} pattern="[a-z0-9][a-z0-9._\-]{1,59}" defaultValue={copy.prompt_version} />
                  </div>
                  <input type="hidden" name="description" value={chain.description ?? ""} />
                </ActionForm>
              </div>
            </details>
            <details className="popover">
              <summary className="btn btn-sm btn-danger">Delete</summary>
              <div className="popover-panel card">
                <p className="sub" style={{ marginTop: 0 }}>Removes the chain and its steps. Media it already generated stays under its name and version.{chain.share ? " Members are using this chain: choose another one for members in Humor Admin first." : ""}</p>
                <ActionForm action={deleteChain} submit="Delete chain" pendingLabel="Deleting…" danger className="form"
                  confirm={`Delete “${chain.name}” and all its steps? This cannot be undone.`}>
                  <input type="hidden" name="id" value={chain.id} />
                </ActionForm>
              </div>
            </details>
          </div>
        </div>
        {chain.mixedModels && steps.length > 0 && (
          <div className="notice notice-warn" role="status" style={{ marginBottom: 14 }}>
            {usedModels > 1 ? `Steps use ${usedModels} different models.` : "Some steps use a different model."} Choose one below and save to put every step on it.
          </div>
        )}
        <ActionForm action={updateChain} submit="Save settings"
          confirm={chain.share === 100 ? "Members use this chain. A new model or prompt version applies to their next generation. Save?" : undefined}>
          <ChainFields initial={chain} models={models} needsVision={seeing} />
        </ActionForm>
      </section>
      <section className="card">
        <h2>Steps</h2>
        <p className="sub">They run top to bottom on {model ? <strong>{model.label}</strong> : "the chain's model"}. Step 1 usually sees the photo; later steps use earlier output through <span className="mono">{"{previous}"}</span> or <span className="mono">{"{stepN}"}</span>. Reorder with ↑ ↓ or drag the ⠿ handle; the order is saved immediately.</p>
        <StepList chainId={chain.id} steps={steps} model={model} supported={SUPPORTED_PROVIDERS} sample={sample} />
      </section>
      <details className="card" open={!steps.length}>
        <summary style={{ fontWeight: 800 }}>+ Add step {steps.length + 1}</summary>
        <div style={{ marginTop: 14 }}>
          {steps.length >= MAX_STEPS ? <p className="empty">A chain can have at most {MAX_STEPS} steps.</p> : (
            <ActionForm action={createStep} submit="Add step" pendingLabel="Adding…" resetOnOk>
              <StepFields chainId={chain.id} model={model} position={steps.length + 1} sample={sample} />
            </ActionForm>
          )}
        </div>
      </details>
    </div>
  );
}

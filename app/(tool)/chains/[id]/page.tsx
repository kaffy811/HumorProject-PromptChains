import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";
import { createStep, deleteChain, duplicateChain, setChainModel, updateChain } from "@/lib/actions";
import { copySuggestion, getChain, latestRunSample, modelOptions } from "@/lib/data";
import { MAX_STEPS } from "@/lib/chain-rules";
import { SUPPORTED_PROVIDERS } from "@/lib/llm";
import { ActionForm } from "@/components/ActionForm";
import { ChainFields } from "@/components/ChainFields";
import { PROVIDER_LABELS } from "@/components/ChainCard";
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
  // Current model(s), e.g. "Gemini 3.8 Flash · Google" or "2 models".
  const used = [...new Set(steps.map((s) => s.modelLabel ?? "no model"))];
  const current = used.length === 1 ? used[0] : `${used.length} models`;
  const seeing = steps.some((s) => s.include_image);
  const byProvider = new Map<string, typeof models>();
  for (const m of models.filter((m) => m.is_active && (!seeing || m.supports_vision))) {
    const key = PROVIDER_LABELS[m.provider ?? ""] ?? m.providerName ?? "Other";
    byProvider.set(key, [...(byProvider.get(key) ?? []), m]);
  }
  return (
    <div className="stack">
      {created && <div className="notice notice-good" role="status">Chain created. Add its steps below.</div>}
      {copied && <div className="notice notice-good" role="status">Copy created with all its steps. Members are not using it; its history starts here.</div>}
      <section className="card">
        <h2>Steps</h2>
        <p className="sub">They run top to bottom. Step 1 usually sees the photo; later steps use earlier output through <span className="mono">{"{previous}"}</span> or <span className="mono">{"{stepN}"}</span>. Reorder with ↑ ↓ or drag the ⠿ handle; the order is saved immediately.</p>
        <StepList chainId={chain.id} steps={steps} models={models} supported={SUPPORTED_PROVIDERS} sample={sample} />
      </section>
      <details className="card" open={!steps.length}>
        <summary style={{ fontWeight: 800 }}>+ Add step {steps.length + 1}</summary>
        <div style={{ marginTop: 14 }}>
          {steps.length >= MAX_STEPS ? <p className="empty">A chain can have at most {MAX_STEPS} steps.</p> : (
            <ActionForm action={createStep} submit="Add step" pendingLabel="Adding…" resetOnOk>
              <StepFields chainId={chain.id} models={models} position={steps.length + 1} sample={sample} />
            </ActionForm>
          )}
        </div>
      </details>
      {steps.length > 0 && (
        <section className="grid grid-2">
          <div className="card" id="model">
            <h2>Model for every step</h2>
            <p className="sub">Now: <strong>{current}</strong>. Switch the whole chain to one model in one save, e.g. from Gemini to GPT{chain.share === 100 ? "; members get the new model on their next generation" : ""}. The change is kept in History, so you can switch back.{seeing ? " Only models that accept images are listed, because a step sees the photo." : ""}</p>
            <ActionForm action={setChainModel} submit="Use for every step" pendingLabel="Switching…" className="form"
              confirm={chain.share === 100 ? "Members use this chain. Switch every step to this model now?" : undefined}>
              <input type="hidden" name="chain_id" value={chain.id} />
              <div className="field">
                <label htmlFor="every-model">Model</label>
                <select id="every-model" name="llm_model_id" className="select" required defaultValue="">
                  <option value="" disabled>Choose a model…</option>
                  {[...byProvider.entries()].map(([provider, list]) => (
                    <optgroup key={provider} label={provider}>{list.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
                  ))}
                </select>
              </div>
            </ActionForm>
          </div>
          <div className="card" id="duplicate">
            <h2>Duplicate chain</h2>
            <p className="sub">Copies the chain and its {steps.length} step{steps.length === 1 ? "" : "s"} under a new prompt version, to try changes without touching this one. Members do not get the copy.</p>
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
        </section>
      )}
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

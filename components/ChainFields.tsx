import type { ModelOption } from "@/lib/data";
import { PROVIDER_LABELS } from "@/components/ChainCard";

type Initial = { id: string; name: string; prompt_version: string; description: string | null; llm_model_id?: string | null };

// Chain settings (create and edit forms): name, prompt version, description
// and the one model every step of the chain uses.
export function ChainFields({ initial, models, needsVision = false }: { initial?: Initial; models: ModelOption[]; needsVision?: boolean }) {
  const key = initial?.id ?? "new";
  // Grouped by provider (Gemini, GPT, …). Models a step cannot use are shown but disabled.
  const groups = new Map<string, ModelOption[]>();
  for (const m of models) {
    const label = PROVIDER_LABELS[m.provider ?? ""] ?? m.providerName ?? "Other";
    groups.set(label, [...(groups.get(label) ?? []), m]);
  }
  const why = (m: ModelOption) => (!m.is_active ? "inactive" : needsVision && !m.supports_vision ? "no images" : null);
  return (
    <div className="form-grid">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="field">
        <label htmlFor={`name-${key}`}>Name</label>
        <input id={`name-${key}`} name="name" className="input" required maxLength={80} defaultValue={initial?.name} placeholder="e.g. Describe → funny → captions" />
      </div>
      <div className="field">
        <label htmlFor={`version-${key}`}>Prompt version</label>
        <input id={`version-${key}`} name="prompt_version" className="input mono" required maxLength={60} pattern="[a-z0-9][a-z0-9._\-]{1,59}" defaultValue={initial?.prompt_version} placeholder="e.g. three-step-v2" />
        <span className="hint">Lowercase, unique. Stamped on every run; renaming it unlinks the runs already recorded under the old version.</span>
      </div>
      <div className="field">
        <label htmlFor={`model-${key}`}>Model</label>
        <select id={`model-${key}`} name="llm_model_id" className="select" defaultValue={initial?.llm_model_id ?? ""} required={!!initial}>
          <option value="" disabled={!!initial}>{initial ? "Choose a model…" : "Choose later"}</option>
          {[...groups.entries()].map(([provider, list]) => (
            <optgroup key={provider} label={provider}>
              {list.map((m) => {
                const off = why(m);
                // The current model stays selectable so saving other fields never fails on it.
                return <option key={m.id} value={m.id} disabled={!!off && m.id !== initial?.llm_model_id}>{m.label.replace(/ \(inactive\)$/, "")}{off ? ` (${off})` : ""}</option>;
              })}
            </optgroup>
          ))}
        </select>
        <span className="hint">Every step uses this model. Switching it (e.g. Gemini → GPT) changes all steps in one save and is kept in History.{needsVision ? " A step sees the photo, so the model must accept images." : ""}</span>
      </div>
      <div className="field">
        <label htmlFor={`desc-${key}`}>Description <span className="muted">(optional)</span></label>
        <textarea id={`desc-${key}`} name="description" className="textarea" rows={3} maxLength={1000} defaultValue={initial?.description ?? ""} />
      </div>
    </div>
  );
}

// Name, prompt version and description of a chain (create and edit forms).
export function ChainFields({ initial }: { initial?: { id: string; name: string; prompt_version: string; description: string | null } }) {
  return (
    <div className="form-grid">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="field">
        <label htmlFor={`name-${initial?.id ?? "new"}`}>Name</label>
        <input id={`name-${initial?.id ?? "new"}`} name="name" className="input" required maxLength={80} defaultValue={initial?.name} placeholder="e.g. Describe → funny → captions" />
      </div>
      <div className="field">
        <label htmlFor={`version-${initial?.id ?? "new"}`}>Prompt version</label>
        <input id={`version-${initial?.id ?? "new"}`} name="prompt_version" className="input mono" required maxLength={60} pattern="[a-z0-9][a-z0-9._\-]{1,59}" defaultValue={initial?.prompt_version} placeholder="e.g. three-step-v2" />
        <span className="hint">Lowercase, unique. Stamped on every run; renaming it unlinks the runs already recorded under the old version.</span>
      </div>
      <div className="field wide">
        <label htmlFor={`desc-${initial?.id ?? "new"}`}>Description <span className="muted">(optional)</span></label>
        <textarea id={`desc-${initial?.id ?? "new"}`} name="description" className="textarea" maxLength={1000} defaultValue={initial?.description ?? ""} />
      </div>
    </div>
  );
}

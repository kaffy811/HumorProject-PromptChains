import { fillPrompt, PLACEHOLDER } from "@/lib/chain-rules";
import { estimateTokens } from "@/lib/flow";

export function chipHelp(token: string) {
  if (token === "{direction}") return "The direction typed for the run (\"none\" when empty)";
  if (token === "{previous}") return "The output of the step right before this one";
  return `The output of step ${token.slice(5, -1)}`;
}

// The template with placeholders marked, and what it looks like filled in.
export function PromptPreview({ template, system, position, sees }: { template: string; system: string; position: number; sees: boolean }) {
  if (!template.trim()) return null;
  const parts: { text: string; token?: { ok: boolean; why: string } }[] = [];
  let last = 0;
  for (const m of template.matchAll(new RegExp(PLACEHOLDER.source, "g"))) {
    if (m.index! > last) parts.push({ text: template.slice(last, m.index) });
    const step = m[2] ? Number(m[2]) : null;
    const ok = m[1] === "direction" || (m[1] === "previous" ? position > 1 : step !== null && step < position);
    parts.push({ text: m[0], token: { ok, why: ok ? chipHelp(m[0]) : m[1] === "previous" ? "Step 1 has no step before it" : `Step ${step} does not run before step ${position}` } });
    last = m.index! + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  const sample = fillPrompt(template, "midterms week", Array.from({ length: position - 1 }, (_, i) => `‹step ${i + 1} output›`));
  const tokens = estimateTokens(system) + estimateTokens(sample);
  return (
    <div className="field wide preview" aria-live="polite">
      <span className="label">Preview <span className="muted">· ≈ {tokens.toLocaleString("en-US")} tokens of prompt text{sees ? " + the photo" : ""}</span></span>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <pre className="prompt" aria-label="Template with placeholders">
          {parts.map((p, i) => p.token ? <mark key={i} className={p.token.ok ? "ph-ok" : "ph-bad"} title={p.token.why}>{p.text}</mark> : <span key={i}>{p.text}</span>)}
        </pre>
        <pre className="prompt" aria-label="Filled with sample data">{sample}</pre>
      </div>
      <span className="hint">Right: filled with the direction “midterms week” and placeholder outputs of earlier steps.</span>
    </div>
  );
}

import { placeholdersIn } from "./chain-rules";

// Positions, connections and variables for the chain canvas. Steps run in a
// line, so the canvas shows only neighbour-to-neighbour connections (photo →
// step 1 → … → captions); what each step reads from earlier steps is listed
// on its card and chosen in the editor, not drawn. Pure, so it is unit-tested.
export const NODE_W = 280, END_W = 170, GAP = 90;
export type CanvasEdgeKind = "photo" | "data" | "order" | "result";
export type CanvasNode = { id: string; type: "photo" | "step" | "result"; x: number; width: number; index?: number };
// insertAt = the position a step added on this connection gets.
export type CanvasEdge = { id: string; source: string; target: string; kind: CanvasEdgeKind; insertAt: number };
type LayoutStep = { id: string; include_image: boolean; user_prompt: string; output_kind: string };

export function canvasLayout(steps: LayoutStep[]) {
  const nodes: CanvasNode[] = [{ id: "photo", type: "photo", x: 0, width: END_W }];
  steps.forEach((s, i) => nodes.push({ id: s.id, type: "step", x: END_W + GAP + i * (NODE_W + GAP), width: NODE_W, index: i }));
  nodes.push({ id: "result", type: "result", x: END_W + GAP + steps.length * (NODE_W + GAP), width: END_W });
  const edges: CanvasEdge[] = [];
  for (let n = 0; n < nodes.length - 1; n++) {
    const from = nodes[n], to = nodes[n + 1];
    // Solid when data really passes: the photo into a step that sees it, a step's
    // output into the next step that reads it, the last step into the result.
    let kind: CanvasEdgeKind = "order";
    if (from.type === "photo") kind = to.type === "step" && steps[0].include_image ? "photo" : "order";
    else if (to.type === "result") kind = "result";
    else if (readsStep(steps[n].user_prompt, n + 1, n)) kind = "data";
    edges.push({ id: `${from.id}>${to.id}`, source: from.id, target: to.id, kind, insertAt: n + 1 });
  }
  return { nodes, edges };
}

// Does the step at `position` read step `source`'s output ({previous} or {stepN})?
function readsStep(template: string, position: number, source: number) {
  return placeholdersIn(template).some((p) => (p.step === "previous" ? position - 1 === source : p.step === source));
}

// Dragging from one node's output point to another's input point: the target
// runs right after the source. Photo → step moves it first; step → captions
// moves it last. Returns the new order, or null when nothing changes.
export function orderAfterConnect(order: string[], source: string, target: string): string[] | null {
  if (source === target) return null;
  let next: string[];
  if (source === "photo" && order.includes(target)) next = [target, ...order.filter((id) => id !== target)];
  else if (target === "result" && order.includes(source)) next = [...order.filter((id) => id !== source), source];
  else if (order.includes(source) && order.includes(target)) {
    next = order.filter((id) => id !== target);
    next.splice(next.indexOf(source) + 1, 0, target);
  } else return null;
  return next.every((id, i) => id === order[i]) ? null : next;
}

export type VarType = "String" | "JSON" | "Image";
export type Variable = { token: string; name: string; type: VarType; help: string; usable: boolean; why?: string };
export type VariableGroup = { title: string; vars: Variable[] };
type BeforeStep = { name: string; include_image: boolean; user_prompt: string; output_kind: string };
const outputType = (kind: string): VarType => (kind === "captions" ? "JSON" : "String");

// What a step reads, with types, for its card and the editor.
export function stepInputs(step: { include_image: boolean; user_prompt: string }, position: number, before: { output_kind: string }[] = []) {
  const inputs: { token: string; label: string; type: VarType; ok: boolean }[] = [];
  if (step.include_image) inputs.push({ token: "photo", label: "photo", type: "Image", ok: true });
  const seen = new Set<string>();
  for (const p of placeholdersIn(step.user_prompt)) {
    if (seen.has(p.token)) continue;
    seen.add(p.token);
    const source = p.step === "previous" ? position - 1 : p.step;
    const ok = p.step === null || (typeof source === "number" && source >= 1 && source < position);
    const type = typeof source === "number" && before[source - 1] ? outputType(before[source - 1].output_kind) : "String";
    inputs.push({ token: p.token, label: p.token.slice(1, -1), type, ok });
  }
  return inputs;
}

// The variable picker for the step at `position`: the run's inputs, then every
// earlier step with what it read and what it returned. Clicking a usable
// variable inserts its token; the photo cannot go into text.
export function variablesFor(position: number, before: BeforeStep[]): VariableGroup[] {
  const groups: VariableGroup[] = [{
    title: "Run inputs",
    vars: [
      { token: "{direction}", name: "direction", type: "String", help: "The direction typed for the run (\"none\" when empty)", usable: true },
      { token: "photo", name: "photo", type: "Image", help: "The run's photo", usable: false, why: "An image cannot go into text: turn on \"Sees the photo\" to attach it." },
    ],
  }];
  before.slice(0, position - 1).forEach((step, i) => {
    const n = i + 1;
    const type = outputType(step.output_kind);
    const json = type === "JSON" ? " It is JSON (captions) and is passed as text." : "";
    const vars: Variable[] = [];
    vars.push({ token: `{step${n}}`, name: `step${n}`, type, help: `Output of step ${n}.${json}`, usable: true });
    if (n === position - 1) vars.push({ token: "{previous}", name: "previous", type, help: `Same as {step${n}}: the step right before this one.${json}`, usable: true });
    // What that step itself read: the same values, under the names it used.
    for (const input of stepInputs(step, n, before)) {
      if (input.token === "photo") continue;
      const source = input.label === "previous" ? n - 1 : input.label.startsWith("step") ? Number(input.label.slice(4)) : null;
      const token = source ? `{step${source}}` : input.token;
      if (vars.some((v) => v.token === token)) continue;
      vars.push({ token, name: `${input.label} (input of step ${n})`, type: input.type, help: source ? `Step ${n} read step ${source}'s output; insert it here as ${token}.` : `Step ${n} read this too.`, usable: input.ok });
    }
    groups.push({ title: `Step ${n} · ${step.name}`, vars });
  });
  return groups;
}

import { flowEdges, type FlowStep } from "./flow";
import { placeholdersIn } from "./chain-rules";

// Positions and connections for the chain canvas: photo → steps → result in
// one row (steps run in order, so nodes are laid out, not dragged). Pure, so
// it is unit-tested; the canvas component only renders it.
export const NODE_W = 280, END_W = 170, GAP = 90;
export type CanvasEdgeKind = "photo" | "previous" | "step" | "result" | "order";
export type CanvasNode = { id: string; type: "photo" | "step" | "result"; x: number; width: number; index?: number };
export type CanvasEdge = {
  id: string; source: string; target: string; kind: CanvasEdgeKind; label?: string;
  // Neighbours share a straight edge with an insert button; insertAt = the new step's position.
  adjacent: boolean; insertAt?: number;
  // Arcs skip nodes: data references above, photo inputs below; span sets their height.
  side?: "top" | "bottom"; span?: number;
};

export function canvasLayout(steps: (FlowStep & { id: string })[]) {
  const nodes: CanvasNode[] = [{ id: "photo", type: "photo", x: 0, width: END_W }];
  steps.forEach((s, i) => nodes.push({ id: s.id, type: "step", x: END_W + GAP + i * (NODE_W + GAP), width: NODE_W, index: i }));
  nodes.push({ id: "result", type: "result", x: END_W + GAP + steps.length * (NODE_W + GAP), width: END_W });
  const idOf = (n: number) => nodes[n].id;
  const raw = flowEdges(steps);
  // The photo always leads into step 1 (or straight to the result when empty).
  if (!raw.some((e) => e.from === 0 && e.to === 1)) raw.unshift({ from: 0, to: 1, kind: "order" });
  const edges: CanvasEdge[] = raw.map((e) => {
    const adjacent = e.to - e.from === 1;
    return {
      id: `${idOf(e.from)}>${idOf(e.to)}`, source: idOf(e.from), target: idOf(e.to), kind: e.kind, label: e.label, adjacent,
      ...(adjacent ? { insertAt: e.to } : { side: e.kind === "photo" ? "bottom" as const : "top" as const, span: e.to - e.from }),
    };
  });
  return { nodes, edges };
}

// What a step reads, for its node and the editor's "Inputs" section.
export function stepInputs(step: { include_image: boolean; user_prompt: string }, position: number) {
  const inputs: { token: string; label: string; ok: boolean }[] = [];
  if (step.include_image) inputs.push({ token: "photo", label: "photo", ok: true });
  const seen = new Set<string>();
  for (const p of placeholdersIn(step.user_prompt)) {
    if (seen.has(p.token)) continue;
    seen.add(p.token);
    const ok = p.step === null || (p.step === "previous" ? position > 1 : p.step < position);
    inputs.push({ token: p.token, label: p.token.slice(1, -1), ok });
  }
  return inputs;
}

// Placeholders a step at this position may use, with plain descriptions.
export function availableInputs(position: number, names: string[]) {
  return [
    { token: "{direction}", help: "The direction typed for the run (\"none\" when empty)" },
    ...(position > 1 ? [{ token: "{previous}", help: `Output of step ${position - 1}${names[position - 2] ? ` · ${names[position - 2]}` : ""}` }] : []),
    ...Array.from({ length: position - 1 }, (_, i) => ({ token: `{step${i + 1}}`, help: `Output of step ${i + 1}${names[i] ? ` · ${names[i]}` : ""}` })),
  ];
}

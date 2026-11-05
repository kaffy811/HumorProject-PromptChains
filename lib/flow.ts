import { placeholdersIn } from "./chain-rules";

// Data flow of a chain for the editor's diagram. Node 0 is the photo, nodes
// 1..n are the steps in order, node n+1 is the result.
export type FlowStep = { include_image: boolean; user_prompt: string; output_kind: string };
export type FlowEdge = { from: number; to: number; kind: "photo" | "previous" | "step" | "result" | "order"; label?: string };

export function flowEdges(steps: FlowStep[]): FlowEdge[] {
  const edges: FlowEdge[] = [];
  const seen = new Set<string>();
  const add = (edge: FlowEdge) => {
    const key = `${edge.from}>${edge.to}`;
    if (seen.has(key) || edge.from >= edge.to) return;
    seen.add(key);
    edges.push(edge);
  };
  steps.forEach((step, index) => {
    const n = index + 1;
    if (step.include_image) add({ from: 0, to: n, kind: "photo" });
    for (const p of placeholdersIn(step.user_prompt)) {
      if (p.step === "previous" && n > 1) add({ from: n - 1, to: n, kind: "previous", label: "{previous}" });
      if (typeof p.step === "number" && p.step < n) add({ from: p.step, to: n, kind: p.step === n - 1 ? "previous" : "step", label: p.token });
    }
  });
  if (steps.length) add({ from: steps.length, to: steps.length + 1, kind: "result" });
  // Steps still run in order even when no data passes between them.
  for (let n = 1; n < steps.length; n++) if (!seen.has(`${n}>${n + 1}`)) add({ from: n, to: n + 1, kind: "order" });
  return edges;
}

// Rough token count for prompt text (≈ 4 characters per token in English).
// Photos are counted differently by each provider, so they are not included.
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

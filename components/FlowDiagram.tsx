import { flowEdges, type FlowStep } from "@/lib/flow";
import { providerLabel } from "@/components/ChainCard";

type Step = FlowStep & { name: string; provider: string | null };
const W = 168, H = 58, GAP = 46, PAD = 12;
const x = (node: number) => PAD + node * (W + GAP);
const short = (text: string, max = 19) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Photo → steps → result, as drawn from the steps' current order and prompts:
// straight arrows join neighbours, {stepN} arcs above, photo inputs arc below.
export function FlowDiagram({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  const edges = flowEdges(steps);
  const last = steps.length + 1;
  const width = x(last) + W + PAD;
  // Room above for {stepN} arcs and below for photo arcs, only when there are some.
  const arcs = edges.filter((e) => e.to - e.from > 1);
  const TOP = arcs.some((e) => e.kind !== "photo") ? 74 : 16;
  const height = TOP + H + (arcs.some((e) => e.kind === "photo") ? 66 : 14);
  const mid = TOP + H / 2;
  return (
    <div className="flow-wrap">
      <svg className="flow" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
        aria-label={`Flow: photo, ${steps.map((s, i) => `step ${i + 1} ${s.name}`).join(", ")}, ${steps.at(-1)?.output_kind === "captions" ? "captions" : "text"}.`}>
        <defs>
          {["ink", "tomato", "muted", "photo"].map((tone) => (
            <marker key={tone} id={`arrow-${tone}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`flow-head-${tone}`} />
            </marker>
          ))}
        </defs>
        {edges.map((e) => {
          const tone = e.kind === "photo" ? "photo" : e.kind === "order" ? "muted" : e.kind === "result" ? "ink" : "tomato";
          const adjacent = e.to - e.from === 1;
          const below = e.kind === "photo" && !adjacent;
          let d: string, lx: number, ly: number;
          if (adjacent) {
            d = `M${x(e.from) + W},${mid} L${x(e.to) - 2},${mid}`;
            lx = (x(e.from) + W + x(e.to)) / 2; ly = mid - 8;
          } else {
            const x1 = x(e.from) + W / 2, x2 = x(e.to) + W / 2;
            const lift = 26 + Math.min(4, e.to - e.from) * 8;
            const y = below ? TOP + H : TOP;
            const cy = below ? y + lift : y - lift;
            d = `M${x1},${y} C${x1},${cy} ${x2},${cy} ${x2},${y + (below ? 2 : -2)}`;
            lx = (x1 + x2) / 2; ly = below ? cy - 4 : cy + 8;
          }
          return (
            <g key={`${e.from}-${e.to}`} className={`flow-edge flow-${tone}`}>
              <path d={d} fill="none" strokeDasharray={e.kind === "order" ? "4 4" : undefined} markerEnd={`url(#arrow-${tone})`} />
              {e.label && !adjacent && <text x={lx} y={ly} textAnchor="middle" className="flow-label">{e.label}</text>}
            </g>
          );
        })}
        <g className="flow-node flow-photo">
          <rect x={x(0)} y={TOP} width={W} height={H} />
          <text x={x(0) + W / 2} y={mid + 5} textAnchor="middle" className="flow-title">📷 Photo</text>
        </g>
        {steps.map((s, i) => (
          <g key={i} className={`flow-node provider-${s.provider ?? "none"}`}>
            <title>{`Step ${i + 1}: ${s.name} · ${providerLabel(s.provider)}${s.include_image ? " · sees the photo" : ""} · returns ${s.output_kind}`}</title>
            <rect x={x(i + 1)} y={TOP} width={W} height={H} />
            <text x={x(i + 1) + 10} y={TOP + 23} className="flow-title">{`${i + 1} · ${short(s.name)}`}</text>
            <text x={x(i + 1) + 10} y={TOP + 43} className="flow-sub">{`${providerLabel(s.provider)} · ${s.output_kind === "captions" ? "captions" : "text"}`}</text>
          </g>
        ))}
        <g className="flow-node flow-result">
          <rect x={x(last)} y={TOP} width={W} height={H} />
          <text x={x(last) + W / 2} y={mid + 5} textAnchor="middle" className="flow-title">{steps.at(-1)?.output_kind === "captions" ? "✦ Captions" : "Text result"}</text>
        </g>
      </svg>
      <div className="flow-legend" aria-hidden="true">
        <span><i className="flow-key flow-tomato" /> passes output</span>
        <span><i className="flow-key flow-photo" /> sees the photo</span>
        <span><i className="flow-key flow-muted dashed" /> runs next (no data)</span>
      </div>
    </div>
  );
}

"use client";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, Handle, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider,
  getStraightPath, useReactFlow, useViewport, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import { reorderSteps } from "@/lib/actions";
import { canvasLayout, stepInputs, END_W, NODE_W, type CanvasEdge } from "@/lib/canvas";
import { chainProblems, moveStep, type Problem } from "@/lib/chain-rules";
import type { ModelOption } from "@/lib/data";
import { providerLabel } from "@/components/ChainCard";
import { StepPanel, type PanelStep } from "@/components/StepPanel";
import type { RunSample } from "@/components/StepTry";

export type CanvasStepRow = PanelStep & { modelLabel: string | null; model: { model_id: string; is_active: boolean; supports_vision: boolean; provider: string | null } | null };
type Actions = { open: (id: string) => void; test: (id: string) => void; move: (from: number, to: number) => void; insert: (at: number) => void; busy: boolean; count: number };
const ActionsContext = createContext<Actions | null>(null);
const useActions = () => useContext(ActionsContext)!;

type StepData = { step: CanvasStepRow; index: number; problems: Problem[]; selected: boolean };
type StepNodeType = Node<StepData, "step">;
type EndData = { label: string; detail: string };
type EdgeData = CanvasEdge;
const PANEL_KEY = "chain-panel-width";

// Coze-style editor: zoomable canvas (photo → steps → captions) with a side
// panel for the selected step. Steps keep their run order, so nodes are laid
// out automatically; order changes via each node's menu (← →).
export function ChainCanvas(props: { chainId: string; steps: CanvasStepRow[]; model: ModelOption | null; supported: string[]; sample: RunSample | null }) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

function Canvas({ chainId, steps, model, supported, sample }: { chainId: string; steps: CanvasStepRow[]; model: ModelOption | null; supported: string[]; sample: RunSample | null }) {
  const [order, setOrder] = useState(() => steps.map((s) => s.id));
  const [synced, setSynced] = useState(steps);
  // Selected step id, or a new step to insert at a position.
  const [selected, setSelected] = useState<string | null>(null);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const dirty = useRef(false);
  const [width, setWidth] = useState(440);
  // The step editor opened as a full page.
  const [full, setFull] = useState(false);
  const flow = useReactFlow();
  // New steps from the server (add, delete, edit, reorder) replace the local order.
  if (synced !== steps) { setSynced(steps); setOrder(steps.map((s) => s.id)); }
  const byId = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const ordered = order.map((id) => byId.get(id)).filter((s): s is CanvasStepRow => !!s);
  const problems = chainProblems(ordered.map((s, i) => ({ ...s, position: i + 1 })), supported);
  const layout = canvasLayout(ordered);

  // The panel width the viewer chose last time (read when the panel opens).
  const restoreWidth = () => { try { const w = Number(localStorage.getItem(PANEL_KEY)); if (w >= 340 && w <= 900) setWidth(w); } catch {} };
  const leave = useCallback(() => !dirty.current || window.confirm("Discard unsaved changes to this step?"), []);
  // Bring a step into view (after the panel has taken its space).
  const focusNode = useCallback((id: string) => {
    setTimeout(() => {
      const node = flow.getNode(id);
      if (node) flow.setCenter(node.position.x + NODE_W / 2, node.position.y + 70, { zoom: Math.max(flow.getZoom(), 0.85), duration: 300 });
    }, 220);
  }, [flow]);
  const open = useCallback((id: string) => { if (id === selected || !leave()) return; dirty.current = false; restoreWidth(); setDraftAt(null); setSelected(id); focusNode(id); }, [selected, leave, focusNode]);
  const insert = useCallback((at: number) => { if (!leave()) return; dirty.current = false; restoreWidth(); setSelected(null); setDraftAt(at); }, [leave]);
  const close = useCallback(() => { if (!leave()) return; dirty.current = false; setSelected(null); setDraftAt(null); setFull(false); }, [leave]);
  const test = useCallback((id: string) => {
    open(id);
    setTimeout(() => {
      const details = document.querySelector<HTMLDetailsElement>(".chain-panel details.try");
      if (details) { details.open = true; details.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }, 60);
  }, [open]);
  const move = useCallback((from: number, to: number) => {
    const next = moveStep(order, from, to);
    if (next === order) return;
    const previous = order;
    setOrder(next); setMessage(null);
    startSaving(async () => {
      const result = await reorderSteps(chainId, next);
      if (result?.error) { setOrder(previous); setMessage({ kind: "bad", text: result.error }); }
      else setMessage({ kind: "good", text: "Order saved." });
    });
  }, [order, chainId]);
  // The open panel reports its own unsaved state (onDirty); saving only changes the selection.
  const onSaved = useCallback((id: string) => { setDraftAt(null); setSelected(id); }, []);
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  // Full page: Esc goes back to the canvas (the expanded prompt editor handles its own Esc), and the page behind does not scroll.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".prompt-modal")) setFull(false); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [full]);
  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const nodes: Node[] = layout.nodes.map((n) => n.type === "step"
    ? { id: n.id, type: "step", position: { x: n.x, y: 0 }, draggable: false, selectable: true, width: NODE_W,
        data: { step: ordered[n.index!], index: n.index!, problems: problems.filter((p) => p.position === n.index! + 1), selected: selected === n.id } satisfies StepData }
    : { id: n.id, type: n.type, position: { x: n.x, y: 22 }, draggable: false, selectable: false, width: END_W,
        data: n.type === "photo"
          ? { label: "📷 Photo", detail: `${ordered.filter((s) => s.include_image).length} step(s) see it` }
          : { label: "✦ Captions", detail: ordered.at(-1)?.output_kind === "captions" ? "from the last step" : "last step returns text" } satisfies EndData });
  const edges: Edge[] = layout.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, type: e.adjacent ? "flow" : "arc", data: e,
    sourceHandle: e.adjacent ? "r" : e.side === "bottom" ? "bs" : "ts", targetHandle: e.adjacent ? "l" : e.side === "bottom" ? "bt" : "tt",
  }));
  // First view: the whole chain when it fits at a readable size, else its start (photo → step 1).
  const box = useRef<HTMLDivElement>(null);
  const contentWidth = layout.nodes.at(-1)!.x + layout.nodes.at(-1)!.width;
  const startView = () => {
    const width = box.current?.clientWidth ?? 800, height = box.current?.clientHeight ?? 560;
    const content = contentWidth;
    const zoom = Math.min(1, (width - 48) / content);
    if (zoom >= 0.75) flow.fitView({ padding: 0.1, maxZoom: 1 });
    else flow.setViewport({ x: 24, y: height / 2 - 90 * 0.85, zoom: 0.85 });
  };
  const panelStep = selected ? byId.get(selected) ?? null : null;
  const panelOpen = !!panelStep || draftAt !== null;
  const panelPosition = panelStep ? order.indexOf(panelStep.id) + 1 : draftAt ?? 0;
  const firstProblem = problems.find((p) => p.position !== null);
  const actions: Actions = { open, test, move, insert, busy: saving, count: ordered.length };

  const resize = (e: React.PointerEvent) => {
    const startX = e.clientX, startW = width;
    const onMove = (m: PointerEvent) => setWidth(Math.min(900, Math.max(340, startW + startX - m.clientX)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
      setWidth((w) => { try { localStorage.setItem(PANEL_KEY, String(w)); } catch {} return w; });
    };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };

  return (
    <ActionsContext.Provider value={actions}>
      {/* The same chain as text, for screen readers and before the canvas loads. */}
      <ol className="sr-only" aria-label="Steps in run order">
        {ordered.map((s, i) => <li key={s.id}>{`Step ${i + 1}: ${s.name}, ${s.include_image ? "sees the photo, " : ""}returns ${s.output_kind}${problems.some((p) => p.position === i + 1 && p.blocking) ? ", has a problem" : ""}`}</li>)}
      </ol>
      <CanvasMarkers />
      <div className={`canvas-wrap${panelOpen ? " with-panel" : ""}`} style={{ "--panel-w": `${width}px` } as React.CSSProperties}>
        <div className="canvas" ref={box} onKeyDown={(e) => {
          // Enter on a focused step opens it, like a click.
          const id = (document.activeElement as HTMLElement | null)?.dataset?.id;
          if (e.key === "Enter" && id && byId.has(id)) open(id);
        }}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
            nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} elementsSelectable
            onNodeClick={(_, node) => { if (byId.has(node.id)) open(node.id); }}
            onInit={startView} minZoom={0.25} maxZoom={1.6}
            proOptions={{ hideAttribution: true }} aria-label="Prompt chain canvas">
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} />
            <MiniMap pannable zoomable className="canvas-minimap" nodeBorderRadius={0} ariaLabel="Overview of the chain" style={{ width: 150, height: 90 }} />
            <Panel position="top-left">
              <div className="canvas-status" aria-live="polite">
                {saving ? <span className="badge">Saving order…</span>
                  : message ? <span className={`badge badge-${message.kind}`}>{message.text}</span> : null}
                {problems.some((p) => p.blocking)
                  ? <button type="button" className="badge badge-bad as-button" onClick={() => { if (firstProblem) open(ordered[firstProblem.position! - 1].id); }}>
                      {problems.filter((p) => p.blocking).length} problem{problems.filter((p) => p.blocking).length === 1 ? "" : "s"}{firstProblem ? " · show" : ""}
                    </button>
                  : ordered.length > 0 && <span className="badge badge-good">Ready to run</span>}
                {problems.filter((p) => p.position === null).map((p) => <span key={p.message} className={`badge badge-${p.blocking ? "bad" : "warn"}`}>{p.message}</span>)}
              </div>
            </Panel>
            <Panel position="bottom-center"><Toolbar onAdd={() => insert(ordered.length + 1)} chainId={chainId} /></Panel>
          </ReactFlow>
        </div>
        {panelOpen && (
          <aside className={`chain-panel${full ? " is-full" : ""}`} aria-label={panelStep ? `Edit step ${panelPosition}` : `New step ${panelPosition}`}>
            <div className="panel-resize" role="separator" aria-orientation="vertical" aria-label="Resize the step editor" onPointerDown={resize} />
            <StepPanel key={panelStep ? `${panelStep.id}:${panelPosition}` : `new:${draftAt}`} chainId={chainId} step={panelStep} position={panelPosition}
              insertAt={panelStep ? null : draftAt} model={model} names={ordered.map((s) => s.name)}
              problems={problems.filter((p) => panelStep && p.position === panelPosition)} sample={sample}
              onClose={close} onSaved={onSaved} onDirty={onDirty} full={full} onToggleFull={() => setFull((f) => !f)} />
          </aside>
        )}
      </div>
    </ActionsContext.Provider>
  );
}

function Toolbar({ onAdd, chainId }: { onAdd: () => void; chainId: string }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const { count } = useActions();
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas">
      <button type="button" className="btn btn-icon" aria-label="Zoom out" onClick={() => zoomOut({ duration: 150 })}>−</button>
      <span className="mono zoom" aria-label="Zoom level">{Math.round(zoom * 100)}%</span>
      <button type="button" className="btn btn-icon" aria-label="Zoom in" onClick={() => zoomIn({ duration: 150 })}>+</button>
      <button type="button" className="btn btn-sm" onClick={() => fitView({ padding: 0.1, maxZoom: 1, minZoom: 0.25, duration: 200 })} title="Show the whole chain">Fit</button>
      <span className="sep" />
      <button type="button" className="btn btn-sm" onClick={onAdd} disabled={count >= 20}>＋ Add step</button>
      <Link className="btn btn-sm btn-primary" href={`/chains/${chainId}/run`}>▶ Run chain</Link>
    </div>
  );
}

const StepNode = memo(function StepNode({ id, data }: NodeProps<StepNodeType>) {
  const { open, test, move, busy, count } = useActions();
  const [menu, setMenu] = useState(false);
  const { step, index, problems, selected } = data;
  const n = index + 1;
  const blocking = problems.some((p) => p.blocking);
  const inputs = stepInputs(step, n);
  const provider = step.model?.provider ?? "none";
  return (
    <div className={`cnode provider-${provider}${selected ? " is-selected" : ""}${blocking ? " has-problem" : problems.length ? " has-warning" : ""}`}>
      <Handles />
      <div className="cnode-head">
        <span className="cnode-num">{n}</span>
        <b className="cnode-title" title={step.name}>{step.name}</b>
        <button type="button" className="cnode-btn nodrag nopan" aria-label={`Test step ${n}`} title="Test this step" onClick={(e) => { e.stopPropagation(); test(id); }}>▶</button>
        <button type="button" className="cnode-btn nodrag nopan" aria-label={`Step ${n} menu`} aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>⋯</button>
      </div>
      {menu && (
        <div className="cnode-menu nodrag nopan" role="menu" onClick={(e) => e.stopPropagation()} onMouseLeave={() => setMenu(false)}>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); open(id); }}>Edit</button>
          <button type="button" role="menuitem" aria-label={`Move step ${n} left`} disabled={index === 0 || busy} onClick={() => { setMenu(false); move(index, index - 1); }}>← Move left</button>
          <button type="button" role="menuitem" aria-label={`Move step ${n} right`} disabled={index === count - 1 || busy} onClick={() => { setMenu(false); move(index, index + 1); }}>Move right →</button>
        </div>
      )}
      <dl className="cnode-rows">
        <dt>Input</dt>
        <dd>{inputs.length ? inputs.map((i) => <span key={i.token} className={`tag${i.ok ? "" : " tag-bad"}`}>{i.label}</span>) : <span className="muted">none</span>}</dd>
        <dt>Output</dt>
        <dd><span className={`tag${step.output_kind === "captions" ? " tag-brand" : ""}`}>{step.output_kind === "captions" ? "captions" : `text → step${n}`}</span></dd>
        <dt>Model</dt>
        <dd className="cnode-model">{step.model ? `${providerLabel(step.model.provider)} · ${step.model.model_id}` : <span className="tag tag-bad">none</span>}</dd>
      </dl>
      {problems.length > 0 && (
        <p className={`cnode-problem${blocking ? "" : " warn"}`} title={problems.map((p) => p.message).join("\n")}>
          {blocking ? "⚠" : "!"} {problems[0].message}{problems.length > 1 ? ` (+${problems.length - 1})` : ""}
        </p>
      )}
    </div>
  );
});

function EndNode({ id, data }: NodeProps<Node<EndData>>) {
  return (
    <div className={`cnode-end ${id}`}>
      <Handles />
      <b>{data.label}</b>
      <span className="hint">{data.detail}</span>
    </div>
  );
}

// Hidden anchor points: sides for neighbours, top for data arcs, bottom for photo arcs.
function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="l" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="r" isConnectable={false} />
      <Handle type="source" position={Position.Top} id="ts" isConnectable={false} />
      <Handle type="target" position={Position.Top} id="tt" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="bs" isConnectable={false} />
      <Handle type="target" position={Position.Bottom} id="bt" isConnectable={false} />
    </>
  );
}

const tone = (kind: string) => (kind === "photo" ? "photo" : kind === "order" ? "muted" : kind === "result" ? "ink" : "tomato");

// Straight edge between neighbours, with a "+" that inserts a step there.
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<EdgeData>>) {
  const { insert, count } = useActions();
  const [path, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const t = tone(data!.kind);
  const at = data!.insertAt!;
  return (
    <>
      <BaseEdge id={id} path={path} className={`cedge cedge-${t}${data!.kind === "order" ? " dashed" : ""}`} markerEnd={`url(#cm-${t})`} />
      <EdgeLabelRenderer>
        <div className="cedge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
          {data!.label && <span className="cedge-text">{data!.label}</span>}
          {count < 20 && <button type="button" className="cedge-add" aria-label={at > count ? "Add a step at the end" : `Insert a step before step ${at}`} title="Insert a step here" onClick={() => insert(at)}>+</button>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// Arc over (data reference) or under (photo) the steps it skips.
function ArcEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<EdgeData>>) {
  const up = data!.side === "top";
  const h = (34 + 26 * Math.min(data!.span ?? 2, 6)) * (up ? -1 : 1);
  const path = `M${sourceX},${sourceY} C${sourceX},${sourceY + h} ${targetX},${targetY + h} ${targetX},${targetY}`;
  const t = tone(data!.kind);
  return (
    <>
      <BaseEdge id={id} path={path} className={`cedge cedge-${t}`} markerEnd={`url(#cm-${t})`} />
      {data!.label && (
        <EdgeLabelRenderer>
          <span className="cedge-text cedge-label" style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${sourceY + h * 0.75}px)` }}>{data!.label}</span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES = { step: StepNode, photo: EndNode, result: EndNode };
const EDGE_TYPES = { flow: FlowEdge, arc: ArcEdge };

// Arrowheads in each edge colour (SVG markers shared by every edge).
function CanvasMarkers() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {["ink", "tomato", "muted", "photo"].map((t) => (
          <marker key={t} id={`cm-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`flow-head-${t}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

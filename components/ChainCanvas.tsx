"use client";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, Handle, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider,
  getStraightPath, useReactFlow, useViewport, type Connection, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import { reorderSteps } from "@/lib/actions";
import { canvasLayout, orderAfterConnect, END_W, NODE_W, type CanvasEdge } from "@/lib/canvas";
import { chainProblems, moveStep, type Problem } from "@/lib/chain-rules";
import type { ModelOption } from "@/lib/data";
import { providerLabel } from "@/components/ChainCard";
import { StepPanel, type PanelStep } from "@/components/StepPanel";
import type { RunSample } from "@/components/StepTry";

export type CanvasStepRow = PanelStep & { modelLabel: string | null; model: { model_id: string; is_active: boolean; supports_vision: boolean; provider: string | null } | null };
type Actions = { open: (id: string) => void; test: (id: string) => void; move: (from: number, to: number) => void; insert: (at: number) => void; busy: boolean; count: number;
  fullscreen: boolean; toggleFullscreen: () => void };
const ActionsContext = createContext<Actions | null>(null);
const useActions = () => useContext(ActionsContext)!;

type StepData = { step: CanvasStepRow; index: number; problems: Problem[]; selected: boolean; before: { output_kind: string }[]; lastRun: string | null };
type StepNodeType = Node<StepData, "step">;
type EndData = { label: string; detail: string };
type EdgeData = CanvasEdge;
const PANEL_KEY = "chain-panel-width";

// Coze-style editor: zoomable canvas (photo → steps → captions) with a side
// panel for the selected step. Steps run in a line, so nodes are laid out
// automatically and only neighbours are connected. Dragging from a node's
// output point to another node's input point makes the second run right after
// the first (a reorder, saved as a version); ⋯ → move left / right does too.
type CanvasProps = { chainId: string; chainName: string; steps: CanvasStepRow[]; model: ModelOption | null; supported: string[]; sample: RunSample | null };
export function ChainCanvas(props: CanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

function Canvas({ chainId, chainName, steps, model, supported, sample }: CanvasProps) {
  const [order, setOrder] = useState(() => steps.map((s) => s.id));
  const [synced, setSynced] = useState(steps);
  // Selected step id, or a new step to insert at a position.
  const [selected, setSelected] = useState<string | null>(null);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const dirty = useRef(false);
  const [width, setWidth] = useState(440);
  // The whole Steps area (canvas and editor) as a full screen.
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
  const close = useCallback(() => { if (!leave()) return; dirty.current = false; setSelected(null); setDraftAt(null); }, [leave]);
  const test = useCallback((id: string) => {
    open(id);
    setTimeout(() => {
      const details = document.querySelector<HTMLDetailsElement>(".chain-panel details.try");
      if (details) { details.open = true; details.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }, 60);
  }, [open]);
  // New order shows at once, is saved atomically (one version) and rolls back on failure.
  const saveOrder = useCallback((next: string[]) => {
    const previous = order;
    setOrder(next); setMessage(null);
    startSaving(async () => {
      const result = await reorderSteps(chainId, next);
      if (result?.error) { setOrder(previous); setMessage({ kind: "bad", text: result.error }); }
      else setMessage({ kind: "good", text: "Order saved." });
    });
  }, [order, chainId]);
  const move = useCallback((from: number, to: number) => { const next = moveStep(order, from, to); if (next !== order) saveOrder(next); }, [order, saveOrder]);
  const connect = useCallback((c: Connection) => { const next = orderAfterConnect(order, c.source, c.target); if (next) saveOrder(next); }, [order, saveOrder]);
  // The open panel reports its own unsaved state (onDirty); saving only changes the selection.
  const onSaved = useCallback((id: string) => { setDraftAt(null); setSelected(id); }, []);
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  // Full screen: Esc goes back (the expanded prompt editor handles its own Esc), and the page behind does not scroll.
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
        data: { step: ordered[n.index!], index: n.index!, problems: problems.filter((p) => p.position === n.index! + 1), selected: selected === n.id,
          before: ordered.slice(0, n.index!), lastRun: sample?.statusByStep?.[n.id] ?? null } satisfies StepData }
    // End nodes are 64px tall: their centre lines up with the steps' anchors (44px below a 6px top border).
    : { id: n.id, type: n.type, position: { x: n.x, y: 18 }, draggable: false, selectable: false, width: END_W,
        data: n.type === "photo"
          ? { label: "📷 Image + ✍ User prompt", detail: `input · ${ordered.filter((s) => s.include_image).length} step(s) see the image` }
          : { label: "✦ Captions", detail: ordered.at(-1)?.output_kind === "captions" ? "from the last step" : "last step returns text" } satisfies EndData });
  const edges: Edge[] = layout.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, type: "flow", data: e, sourceHandle: "r", targetHandle: "l",
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
  const toggleFullscreen = useCallback(() => { setFull((f) => !f); setTimeout(() => flow.fitView({ padding: 0.1, minZoom: 0.7, maxZoom: 1, duration: 200 }), 80); }, [flow]);
  const actions: Actions = { open, test, move, insert, busy: saving, count: ordered.length, fullscreen: full, toggleFullscreen };
  const blockingCount = problems.filter((p) => p.blocking).length;

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
      <div className={`canvas-wrap${panelOpen ? " with-panel" : ""}${full ? " is-fullscreen" : ""}`} style={{ "--panel-w": `${width}px` } as React.CSSProperties}
        role={full ? "dialog" : undefined} aria-modal={full || undefined} aria-label={full ? `Steps of ${chainName}` : undefined}>
        {full && (
          <header className="fs-bar">
            <b>{chainName}</b>
            <span className="hint">{ordered.length} step{ordered.length === 1 ? "" : "s"} · {model ? model.label : "no model yet"}</span>
            {blockingCount ? <span className="badge badge-bad">{blockingCount} problem{blockingCount === 1 ? "" : "s"}</span> : ordered.length > 0 && <span className="badge badge-good">Ready to run</span>}
            <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={toggleFullscreen} title="Esc">⤡ Exit full screen</button>
          </header>
        )}
        <div className="canvas" ref={box} onKeyDown={(e) => {
          // Enter on a focused step opens it, like a click.
          const id = (document.activeElement as HTMLElement | null)?.dataset?.id;
          if (e.key === "Enter" && id && byId.has(id)) open(id);
        }}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
            nodesDraggable={false} nodesConnectable edgesFocusable={false} elementsSelectable
            onConnect={connect} isValidConnection={(c) => !!orderAfterConnect(order, c.source, c.target)}
            connectionLineStyle={{ stroke: "var(--tomato)", strokeWidth: 2.5, strokeDasharray: "6 4" }}
            onNodeClick={(_, node) => { if (byId.has(node.id)) open(node.id); }}
            onInit={startView} minZoom={0.25} maxZoom={1.6}
            proOptions={{ hideAttribution: true }} aria-label="Prompt chain canvas">
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} />
            <MiniMap pannable zoomable className="canvas-minimap" nodeBorderRadius={0} ariaLabel="Overview of the chain" style={{ width: 150, height: 90 }} />
            <Panel position="top-left">
              <div className={`canvas-status${full ? " in-fullscreen" : ""}`} aria-live="polite">
                {saving ? <span className="badge">Saving order…</span>
                  : message ? <span className={`badge badge-${message.kind}`}>{message.text}</span> : null}
                {blockingCount
                  ? <button type="button" className="badge badge-bad as-button" onClick={() => { if (firstProblem) open(ordered[firstProblem.position! - 1].id); }}>
                      {blockingCount} problem{blockingCount === 1 ? "" : "s"}{firstProblem ? " · show" : ""}
                    </button>
                  : ordered.length > 0 && !full && <span className="badge badge-good">Ready to run</span>}
                {problems.filter((p) => p.position === null).map((p) => <span key={p.message} className={`badge badge-${p.blocking ? "bad" : "warn"}`}>{p.message}</span>)}
              </div>
            </Panel>
            <Panel position="bottom-center"><Toolbar onAdd={() => insert(ordered.length + 1)} chainId={chainId} /></Panel>
          </ReactFlow>
        </div>
        {panelOpen && (
          <aside className="chain-panel" aria-label={panelStep ? `Edit step ${panelPosition}` : `New step ${panelPosition}`}>
            <div className="panel-resize" role="separator" aria-orientation="vertical" aria-label="Resize the step editor" onPointerDown={resize} />
            <StepPanel key={panelStep ? `${panelStep.id}:${panelPosition}` : `new:${draftAt}`} chainId={chainId} step={panelStep} position={panelPosition}
              insertAt={panelStep ? null : draftAt} total={panelStep ? ordered.length : ordered.length + 1} model={model} before={ordered.slice(0, panelPosition - 1)}
              problems={problems.filter((p) => panelStep && p.position === panelPosition)} sample={sample}
              onClose={close} onSaved={onSaved} onDirty={onDirty} />
          </aside>
        )}
      </div>
    </ActionsContext.Provider>
  );
}

function Toolbar({ onAdd, chainId }: { onAdd: () => void; chainId: string }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const { count, fullscreen, toggleFullscreen } = useActions();
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas">
      <button type="button" className="btn btn-icon" aria-label="Zoom out" onClick={() => zoomOut({ duration: 150 })}>−</button>
      <span className="mono zoom" aria-label="Zoom level">{Math.round(zoom * 100)}%</span>
      <button type="button" className="btn btn-icon" aria-label="Zoom in" onClick={() => zoomIn({ duration: 150 })}>+</button>
      <button type="button" className="btn btn-sm" onClick={() => fitView({ padding: 0.1, maxZoom: 1, minZoom: 0.25, duration: 200 })} title="Show the whole chain">Fit</button>
      <span className="sep" />
      <button type="button" className="btn btn-sm" onClick={onAdd} disabled={count >= 20}>＋ Add step</button>
      <Link className="btn btn-sm btn-primary" href={`/chains/${chainId}/run`}>▶ Run chain</Link>
      <span className="sep" />
      <button type="button" className="btn btn-sm" aria-pressed={fullscreen} onClick={toggleFullscreen} title={fullscreen ? "Back to the page (Esc)" : "Canvas and editor as a full screen"}>{fullscreen ? "⤡ Exit" : "⤢ Full screen"}</button>
    </div>
  );
}

const StepNode = memo(function StepNode({ id, data }: NodeProps<StepNodeType>) {
  const { open, test, move, busy, count } = useActions();
  const [menu, setMenu] = useState(false);
  const { step, index, problems, selected, before, lastRun } = data;
  const n = index + 1;
  const blocking = problems.some((p) => p.blocking);
  // Status: not set up (no model) › problem › last run › ready.
  const status = !step.model ? { label: "Not set up", tone: "warn" }
    : blocking ? { label: "Problem", tone: "bad" }
    : lastRun === "completed" ? { label: "Last run ✓", tone: "good" }
    : lastRun === "failed" ? { label: "Last run failed", tone: "bad" }
    : { label: "Ready", tone: "" };
  return (
    <div className={`cnode${step.model ? "" : " no-model"}${selected ? " is-selected" : ""}${blocking ? " has-problem" : problems.length ? " has-warning" : ""}`}>
      <Handle type="target" position={Position.Left} id="l" className="anchor" title="Input: drop a connection here to run this step right after that one" />
      <Handle type="source" position={Position.Right} id="r" className="anchor" title="Output: drag to another step's input to run it right after this one" />
      <div className="cnode-head">
        <span className="cnode-num" aria-hidden="true">{n}</span>
        <span className="cnode-icon" aria-hidden="true">{step.output_kind === "captions" ? "✦" : "✎"}</span>
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
      <span className={`cnode-status${status.tone ? ` tone-${status.tone}` : ""}`}>{status.label}</span>
      <dl className="cnode-rows">
        <dt>Input</dt>
        <dd>
          <span className="tag">user prompt <i>String</i></span>
          {step.include_image && <span className="tag">image <i>Image</i></span>}
          {before.map((b, i) => <span key={i} className="tag" title={`Output of step ${i + 1}`}>step{i + 1} <i>{b.output_kind === "captions" ? "JSON" : "String"}</i></span>)}
        </dd>
        <dt>Output</dt>
        <dd><span className={`tag${step.output_kind === "captions" ? " tag-brand" : ""}`}>{step.output_kind === "captions" ? <>captions <i>JSON</i></> : <>step{n} <i>String</i></>}</span></dd>
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
      {id === "photo"
        ? <Handle type="source" position={Position.Right} id="r" className="anchor" title="Drag to a step to run it first" />
        : <Handle type="target" position={Position.Left} id="l" className="anchor" title="Drop a step's output here to run it last" />}
      <b>{data.label}</b>
      <span className="hint">{data.detail}</span>
    </div>
  );
}

const tone = (kind: string) => (kind === "photo" ? "photo" : kind === "order" ? "muted" : kind === "result" ? "ink" : "tomato");

// Straight edge between neighbours, with a "+" that inserts a step there.
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<EdgeData>>) {
  const { insert, count } = useActions();
  const [path, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const t = tone(data!.kind);
  const at = data!.insertAt;
  return (
    <>
      <BaseEdge id={id} path={path} className={`cedge cedge-${t}${data!.kind === "order" ? " dashed" : ""}`} markerEnd={`url(#cm-${t})`} />
      <EdgeLabelRenderer>
        <div className="cedge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
          {count < 20 && <button type="button" className="cedge-add" aria-label={at > count ? "Add a step at the end" : `Insert a step before step ${at}`} title="Insert a step here" onClick={() => insert(at)}>+</button>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const NODE_TYPES = { step: StepNode, photo: EndNode, result: EndNode };
const EDGE_TYPES = { flow: FlowEdge };

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

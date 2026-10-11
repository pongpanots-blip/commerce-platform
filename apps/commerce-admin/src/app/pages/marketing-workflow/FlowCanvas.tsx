// ui-copy-migration: only literal UI copy and notification templates
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Background, BackgroundVariant, ConnectionMode, Controls, MarkerType, ReactFlow, ReactFlowProvider, useEdgesState, useNodesInitialized,
  useNodesState, useReactFlow, useStoreApi, type Connection, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react';
import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { CanvasPosition, TriggerType, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { confirmRemoveStep, flowNodeTypes, type FlowNode } from './NodeCard';
import { categoryOf, itemOf, kindOf, PALETTE, type PaletteItem } from './palette-items';
import { DRAG_TYPE, Palette } from './Palette';
import { autoLayout, outPorts, TRIGGER, type Anchor, type Graph, type StepKind } from './workflow-graph';

export interface FlowCanvasProps {
  graph: Graph; positions: Record<string, CanvasPosition>; triggerType: TriggerType; triggerTitle: string; triggerSubtitle: string;
  selectedId: string | null; issuesByStep: Record<string, string>; limits: WorkflowMeta['limits'];
  describe: (step: WorkflowStep) => { title: string; subtitle: string };
  onSelect: (id: string | null) => void; onMove: (id: string, pos: CanvasPosition) => void;
  onInsert: (kind: StepKind, anchor: Anchor) => void; onAddLoose: (kind: StepKind, pos: CanvasPosition) => void;
  onConnect: (from: Anchor, to: string) => void; onDisconnect: (from: Anchor) => void; onRemove: (id: string) => void;
}

/** Same workaround as the josh canvas: nodes loaded in a hidden tab never measure → force it, then fit. */
function MeasurementWatchdog() {
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const storeApi = useStoreApi();
  const [attempt, setAttempt] = useState(0);
  const kicked = useRef(false);
  useEffect(() => {
    if (nodesInitialized) { if (kicked.current) { kicked.current = false; fitView({ padding: 0.3, maxZoom: 1 }); } return; }
    if (attempt >= 10) return;
    const timer = setTimeout(() => {
      const { domNode, updateNodeInternals } = storeApi.getState();
      const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: boolean }>();
      domNode?.querySelectorAll<HTMLDivElement>('.react-flow__node[data-id]').forEach((el) => {
        const id = el.getAttribute('data-id');
        if (id) updates.set(id, { id, nodeElement: el, force: true });
      });
      if (updates.size > 0) { kicked.current = true; updateNodeInternals(updates); }
      setAttempt((a) => a + 1);
    }, 100);
    return () => clearTimeout(timer);
  }, [nodesInitialized, attempt, fitView, storeApi]);
  return null;
}

const SINGLE_EXIT = new Set(['action', 'webhook', 'audience', 'wait']);

function Canvas(p: FlowCanvasProps) {
  __useUiLocale();
  const { screenToFlowPosition, getIntersectingNodes } = useReactFlow();
  const [plus, setPlus] = useState<{ anchor: Anchor; x: number; y: number } | null>(null);
  const layout = useMemo(() => ({ ...autoLayout(p.graph), ...p.positions }), [p.graph, p.positions]);

  const computedNodes: FlowNode[] = useMemo(() => {
    const entry = PALETTE[0];
    const triggerNode: FlowNode = { id: TRIGGER, type: 'flowStep', position: layout[TRIGGER] ?? { x: 0, y: 0 }, draggable: false, deletable: false,
      selected: p.selectedId === TRIGGER, data: { title: p.triggerTitle, subtitle: p.triggerSubtitle, color: entry.color,
        icon: itemOf(p.triggerType)?.icon ?? 'bolt', isTrigger: true, issue: p.issuesByStep[TRIGGER],
        ports: [{ label: '', free: !p.graph.entryStepId }], onPlus: (_port, r) => setPlus({ anchor: { stepId: TRIGGER }, x: r.right, y: r.top }) } };
    return [triggerNode, ...p.graph.steps.map((s): FlowNode => {
      const kind = kindOf(s);
      const d = p.describe(s);
      return { id: s.id, type: 'flowStep', position: layout[s.id] ?? { x: 0, y: 0 }, selected: p.selectedId === s.id,
        data: { title: d.title, subtitle: d.subtitle, color: categoryOf(kind).color, icon: itemOf(kind)?.icon ?? 'circle', isTrigger: false,
          issue: p.issuesByStep[s.id], ports: outPorts(s).map((o) => ({ port: o.port, label: o.label, free: o.target === null })),
          onPlus: (port, r) => setPlus({ anchor: { stepId: s.id, port }, x: r.right, y: r.top }), onRemove: () => p.onRemove(s.id) } };
    })];
  }, [p, layout]);

  const computedEdges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    const add = (source: string, port: string | undefined, target: string | null, label?: string) => {
      if (target) out.push({ id: `${source}:${port ?? ''}->${target}`, source, sourceHandle: port, target, type: 'smoothstep', label,
        markerEnd: { type: MarkerType.ArrowClosed }, data: { port } });
    };
    add(TRIGGER, undefined, p.graph.entryStepId);
    for (const s of p.graph.steps) for (const o of outPorts(s)) add(s.id, o.port, o.target, SINGLE_EXIT.has(s.type) ? undefined : o.label);
    return out;
  }, [p.graph]);

  // xyflow keeps measured sizes, drag positions and selection on its own node state (as the josh canvas does);
  // the editor's graph is the source of truth and is pushed in on every change, keeping `measured`.
  const [nodes, setNodes, applyNodeChanges] = useNodesState<FlowNode>([]);
  const [edges, setEdges, applyEdgeChanges] = useEdgesState<Edge>([]);
  useEffect(() => {
    setNodes((prev) => computedNodes.map((n) => ({ ...n, measured: prev.find((x) => x.id === n.id)?.measured })));
  }, [computedNodes, setNodes]);
  useEffect(() => { setEdges(computedEdges); }, [computedEdges, setEdges]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    applyNodeChanges(changes.filter((c) => c.type !== 'remove'));
    for (const c of changes) {
      if (c.type === 'remove' && c.id !== TRIGGER) p.onRemove(c.id);
      if (c.type === 'select' && c.selected) p.onSelect(c.id);
    }
  }, [applyNodeChanges, p]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    applyEdgeChanges(changes.filter((c) => c.type !== 'remove'));
    for (const c of changes) if (c.type === 'remove') {
      const e = edges.find((x) => x.id === c.id);
      if (e) p.onDisconnect({ stepId: e.source, port: (e.data as { port?: string } | undefined)?.port });
    }
  }, [applyEdgeChanges, edges, p]);
  const onConnect = useCallback((c: Connection) => { if (c.source && c.target) p.onConnect({ stepId: c.source, port: c.sourceHandle ?? undefined }, c.target); }, [p]);
  const isValidConnection = useCallback((c: Connection | Edge) => !c.target || (c.source !== c.target && c.target !== TRIGGER), []);

  const onDrop = useCallback((e: DragEvent) => {
    const kind = e.dataTransfer.getData(DRAG_TYPE) as StepKind;
    if (!kind) return;
    e.preventDefault();
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const hit = getIntersectingNodes({ x: pos.x, y: pos.y, width: 1, height: 1 })[0];
    if (!hit) return p.onAddLoose(kind, pos);
    if (hit.id === TRIGGER) return p.onInsert(kind, { stepId: TRIGGER });
    const step = p.graph.steps.find((s) => s.id === hit.id);
    const ports = step ? outPorts(step) : [];
    if (ports.length <= 1) return p.onInsert(kind, { stepId: hit.id, port: ports[0]?.port });
    const free = ports.find((o) => o.target === null);
    if (free) return p.onInsert(kind, { stepId: hit.id, port: free.port });
    // Every exit is taken: insert on the first one (the old target continues behind the new step).
    p.onInsert(kind, { stepId: hit.id, port: ports[0].port });
  }, [getIntersectingNodes, p, screenToFlowPosition]);

  const pick = (item: PaletteItem) => { if (plus && !item.trigger) p.onInsert(item.id as StepKind, plus.anchor); setPlus(null); };

  return (
    <div className="relative h-full w-full rounded-xl border border-outline-variant bg-surface-container-low"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={flowNodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} isValidConnection={isValidConnection}
        onNodeDragStop={((_: unknown, n: FlowNode) => { if (n.id !== TRIGGER) p.onMove(n.id, n.position); }) as never}
        onPaneClick={() => { p.onSelect(null); setPlus(null); }} connectionMode={ConnectionMode.Loose} connectionRadius={48}
        deleteKeyCode={['Backspace', 'Delete']} onBeforeDelete={async ({ nodes: removing }) => removing.every((n) => n.id === TRIGGER) || confirmRemoveStep()} fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{ 'controls.ariaLabel': __uiText('Workflow controls'), 'controls.zoomIn.ariaLabel': __uiText('Zoom in'),
          'controls.zoomOut.ariaLabel': __uiText('Zoom out'), 'controls.fitView.ariaLabel': __uiText('Fit view'), 'controls.interactive.ariaLabel': __uiText('Toggle interactivity') }}>
        <MeasurementWatchdog />
        <Background variant={BackgroundVariant.Lines} gap={24} color="var(--color-secondary-container)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {!p.graph.steps.length && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-on-surface-variant">
          {__uiText('ลากขั้นตอนจากแถบซ้ายมาวาง หรือกดปุ่ม + ข้างการ์ดจุดเริ่ม')}
        </div>
      )}
      {plus && (
        <div className="fixed z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest p-2 shadow-raised" style={{ left: plus.x + 8, top: plus.y }}>
          <Palette compact steps={p.graph.steps} triggerType={p.triggerType} limits={p.limits} onPick={pick} />
        </div>
      )}
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

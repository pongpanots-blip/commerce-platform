// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type NodeMouseHandler,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  MarketingPageAffinityTriggerConfig,
  MarketingStep,
  MarketingTriggerConfig,
  MarketingTriggerType,
  MarketingWorkflowSchedule,
  UserSegmentListItem,
} from './shared-api';
import {
  marketingNodeTypes,
  type MarketingFlowNode,
  type MarketingNodeCardData,
} from './MarketingNodeCards';
import { formatDurationLabel } from './trigger-rule.helpers';

/**
 * Vertical, mostly-linear canvas (Agently-style): trigger card derived from
 * `trigger_type`/`trigger_config` (not a step), one card per `steps[]` entry,
 * dotted background, large white cards. Does NOT import from
 * `apps/web-admin/src/app/components/bot/*` — separate product, separate canvas.
 */

export const TRIGGER_NODE_ID = 'trigger';
export const NODE_GAP_Y = 170;

export type MarketingCanvasPosition = { x: number; y: number };

type MarketingFlowCanvasProps = {
  triggerType: MarketingTriggerType;
  triggerConfig: MarketingTriggerConfig;
  schedule: MarketingWorkflowSchedule;
  steps: MarketingStep[];
  positions: Record<string, MarketingCanvasPosition>;
  segments: UserSegmentListItem[];
  coupons: Array<{ id: string; coupon_code: string; title: string }>;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onNodeMove: (id: string, position: MarketingCanvasPosition) => void;
  onDeleteStep: (stepId: string) => void;
  onUpdateTriggerType: (type: MarketingTriggerType) => void;
  onConnectSteps: (connection: {
    source: string;
    target: string;
    sourceHandle?: string | null;
  }) => void;
  onDisconnectEdge: (edge: {
    source: string;
    target: string;
    sourceHandle?: string | null;
  }) => void;
};

const SCHEDULE_DOW_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/** Shared by the trigger node subtitle and the editor's header summary. */
export function describeMarketingSchedule(schedule: MarketingWorkflowSchedule): string {
  if (!schedule) return __uiText("ตลอดเวลา (ไม่จำกัดช่วงเวลา)");

  const days =
    schedule.daysOfWeek && schedule.daysOfWeek.length > 0 && schedule.daysOfWeek.length < 7
      ? [...schedule.daysOfWeek].sort().map((d) => (__dateLocale() === 'th' ? SCHEDULE_DOW_LABELS : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[d] ?? d).join(',')
      : __uiText("ทุกวัน");
  const time = __uiText("{0}-{1} น.",{"0":schedule.startTime ?? '00:00',"1":schedule.endTime ?? '24:00'});
  const tz = schedule.timezone && schedule.timezone !== 'Asia/Bangkok' ? ` (${schedule.timezone})` : '';

  const bounds: string[] = [];
  if (schedule.activeFrom) {
    bounds.push(__uiText("ตั้งแต่ {0}",{"0":new Date(schedule.activeFrom).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}));
  }
  if (schedule.activeTo) {
    bounds.push(__uiText("ถึง {0}",{"0":new Date(schedule.activeTo).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}));
  }

  return [`${days} ${time}${tz}`, ...bounds].join(' · ');
}

const PAGE_AFFINITY_TYPE_LABEL: Record<MarketingPageAffinityTriggerConfig['pageType'], string> = {
  get pdp(){return __uiText("สินค้า");},
  get category(){return __uiText("หมวดหมู่");},
  get cart(){return __uiText("ตะกร้า");},
  get path(){return __uiText("Path");},
};

function describePageAffinity(config: Partial<MarketingPageAffinityTriggerConfig>): string {
  const pageType = config.pageType ?? 'pdp';
  const label = PAGE_AFFINITY_TYPE_LABEL[pageType] ?? pageType;
  const target =
    pageType === 'path'
      ? config.path || __uiText("ยังไม่ระบุ path")
      : pageType === 'cart'
        ? ''
        : config.entityId || __uiText("ยังไม่ระบุ ID");
  const targetPart = target ? ` (${target})` : '';
  return __uiText("เข้าชม{0}{1} อย่างน้อย {2} ครั้ง ภายใน {3}",{"0":label,"1":targetPart,"2":config.minViews ?? '-',"3":formatDurationLabel(config.windowHours, config.windowMinutes)});
}

function describeTrigger(triggerType: MarketingTriggerType, triggerConfig: MarketingTriggerConfig): string {
  if (triggerType === 'page_affinity') {
    return describePageAffinity(triggerConfig as Partial<MarketingPageAffinityTriggerConfig>);
  }
  if (triggerType === 'session_in_window') {
    const lookback =
      (triggerConfig as { lookbackMinutes?: number }).lookbackMinutes ?? 20;
    return __uiText("คนที่ login ภายใน {0} นาที (+ segment ถ้าเลือก) ในช่วง Schedule",{"0":lookback});
  }
  if (triggerType === 'first_login') {
    return __uiText("เมื่อลูกค้า login ครั้งแรกบนแอป/เว็บ");
  }
  if (triggerType === 'first_visit') {
    return __uiText("เมื่อเปิดเว็บครั้งแรกบนอุปกรณ์นี้ (guest ได้)");
  }
  if (triggerType === 'custom') {
    const custom = triggerConfig as {
      label?: string;
      description?: string;
      delayMinutes?: number;
      source?: { kind?: string; valuePath?: string; operator?: string; value?: unknown; intervalMinutes?: number };
    };
    const label = custom.label?.trim() || __uiText("ยังไม่ตั้งชื่อเงื่อนไข");
    const desc = custom.description?.trim();
    const delay = Number(custom.delayMinutes) || 0;
    const audiencePart =
      delay > 0
        ? __uiText("ทุกคนที่อยู่บนเว็บครบ {0} นาทีได้ action",{"0":delay})
        : __uiText("ทุกคนที่เข้าเว็บช่วงเงื่อนไขได้ action");
    const sourceLine =
      custom.source?.kind === 'http'
        ? __uiText("เช็คอัตโนมัติจาก API ทุก {0} นาที ({1} {2} {3})",{"0":custom.source.intervalMinutes ?? 5,"1":custom.source.valuePath ?? '?',"2":custom.source.operator ?? '==',"3":String(custom.source.value ?? '')})
        : __uiText("เปิด/ปิดเอง: Activate เมื่อเริ่มช่วง, Pause เมื่อจบ");
    return __uiText("\"{0}\" — {1} (วันละ 1 ครั้ง/เครื่อง)\n{2}{3}",{"0":label,"1":audiencePart,"2":sourceLine,"3":desc ? `\n${desc}` : ''});
  }
  if (triggerType === 'scheduled') {
    const cfg = triggerConfig as { time?: string; daysOfWeek?: number[] };
    const dowLabels: Record<number, string> = { 0: __uiText("อา"), 1: __uiText("จ"), 2: __uiText("อ"), 3: __uiText("พ"), 4: __uiText("พฤ"), 5: __uiText("ศ"), 6: __uiText("ส") };
    const days = cfg.daysOfWeek ?? [];
    const dayText = days.length === 0 ? __uiText("ทุกวัน") : days.map((d) => dowLabels[d] ?? d).join(', ');
    return __uiText("ยิงทุก{0} เวลา {1} น. — ส่ง Audience ที่เลือก (คนละ 1 ครั้ง/รอบ)",{"0":dayText,"1":cfg.time ?? '18:00'});
  }
  if (triggerType === 'order_milestone') {
    const cfg = triggerConfig as { metric?: string; operator?: string; value?: number };
    const meta = ORDER_MILESTONE_METRIC_LABEL[cfg.metric ?? 'single_order_total'] ?? {
      label: cfg.metric ?? '?',
      unit: '',
    };
    const op = cfg.operator === '>' ? __uiText("มากกว่า") : __uiText("ถึง/เกิน");
    return __uiText("{0} {1} {2} {3} — ทำงานครั้งแรกที่เข้าเงื่อนไข (คนละ 1 ครั้ง)",{"0":meta.label,"1":op,"2":Number(cfg.value ?? 0).toLocaleString(),"3":meta.unit});
  }
  const idle = triggerConfig as { idleHours?: number; idleMinutes?: number };
  return __uiText("เริ่ม workflow เมื่อตะกร้าค้าง {0}",{"0":formatDurationLabel(idle.idleHours ?? 24, idle.idleMinutes ?? 0)});
}

const TRIGGER_TITLE: Record<MarketingTriggerType, string> = {
  cart_idle: 'ตะกร้าค้าง (Cart Idle)',
  page_affinity: 'เข้าชมหน้าค้าง (Page Affinity)',
  session_in_window: 'ช่วงเวลา + Login (Session In Window)',
  first_login: 'Login ครั้งแรก (First Login)',
  first_visit: 'เข้าเว็บครั้งแรก (First Visit)',
  custom: 'กำหนดเอง (Custom)',
  order_milestone: 'ยอดสั่งซื้อถึงเป้า (Milestone)',
  scheduled: 'ตามเวลา (Scheduled)',
};

const ORDER_MILESTONE_METRIC_LABEL: Record<string, { label: string; unit: string }> = {
  single_order_total: { get label(){return __uiText("ยอดออเดอร์ครั้งเดียว");}, get unit(){return __uiText("บาท");} },
  lifetime_spend: { get label(){return __uiText("ยอดสั่งซื้อสะสมทั้งหมด");}, get unit(){return __uiText("บาท");} },
  lifetime_order_count: { get label(){return __uiText("จำนวนออเดอร์สะสม");}, get unit(){return __uiText("ครั้ง");} },
};

function describeAudience(
  step: Extract<MarketingStep, { type: 'audience' }>,
  segments: UserSegmentListItem[],
): string {
  const nameOf = (id: string) => segments.find((s) => s.id === id)?.name ?? id.slice(0, 8);
  const include = step.segmentIds ?? [];
  const exclude = step.excludeSegmentIds ?? [];

  if (include.length === 0 && exclude.length === 0) {
    return __uiText("ทุกคนที่เข้าเงื่อนไข trigger (ไม่กรอง segment เพิ่ม)");
  }

  const lines: string[] = [];
  if (include.length > 0) {
    lines.push(__uiText("รวม: {0}",{"0":include.map(nameOf).join(', ')}));
  }
  if (exclude.length > 0) {
    lines.push(__uiText("ไม่รวม: {0}",{"0":exclude.map(nameOf).join(', ')}));
  }
  return lines.join('\n');
}

function describeCondition(step: Extract<MarketingStep, { type: 'condition' }>): string {
  return step.expression.trim() || __uiText("ยังไม่ได้ตั้งเงื่อนไข");
}

/**
 * Card label for a step's coupon. Deliberately never prints the raw UUID —
 * an id is meaningless to a marketer reading the canvas, so an unresolvable
 * coupon reads as "missing" instead.
 */
function describeCoupon(
  couponId: string | undefined,
  coupons: Array<{ id: string; coupon_code: string; title: string }>,
): string {
  if (!couponId) return __uiText("ยังไม่ได้เลือกคูปอง");
  const coupon = coupons.find((c) => c.id === couponId);
  return coupon ? coupon.title : __uiText("คูปองถูกลบ/ไม่พบในรายการ");
}

function describeAction(
  step: Extract<MarketingStep, { type: 'action' }>,
  coupons: Array<{ id: string; coupon_code: string; title: string }>,
): { title: string; subtitle: string } {
  if (step.action.kind === 'grant_coupon') {
    return {
      title: __uiText("แจกคูปอง (Grant Coupon)"),
      subtitle: describeCoupon(step.action.couponId, coupons),
    };
  }
  if (step.action.kind === 'show_offer') {
    if (step.action.displayOnly) {
      return {
        title: __uiText("แสดง Popup (โฆษณา)"),
        subtitle: [
          step.action.title?.trim() || __uiText("ไม่มีหัวข้อ"),
          __uiText("สูงสุด {0} ครั้ง/session",{"0":step.action.maxPerSession ?? 1}),
        ].join('\n'),
      };
    }
    return {
      title: __uiText("แสดง Offer บน Shop"),
      subtitle: [
        step.action.title?.trim() || __uiText("ไม่มีหัวข้อกำหนดเอง"),
        describeCoupon(step.action.couponId, coupons),
      ].join('\n'),
    };
  }
  const channels = step.action.channels?.length ? step.action.channels.join(', ') : __uiText("ยังไม่เลือกช่องทาง");
  return {
    title: __uiText("แจ้งเตือน (Notify)"),
    subtitle: __uiText("ช่องทาง: {0}\nTemplate: {1}",{"0":channels,"1":step.action.templateKey || __uiText("ยังไม่ได้เลือก")}),
  };
}

function buildNodeData(
  step: MarketingStep,
  segments: UserSegmentListItem[],
  coupons: Array<{ id: string; coupon_code: string; title: string }>,
  onRemove: () => void,
): MarketingNodeCardData {
  switch (step.type) {
    case 'audience':
      return {
        kind: 'audience',
        title: __uiText("กลุ่มเป้าหมาย (Audience)"),
        subtitle: describeAudience(step, segments),
        removable: false,
      };
    case 'wait':
      return {
        kind: 'wait',
        title: __uiText("รอ (Wait)"),
        subtitle: __uiText("หน่วงเวลา {0} ก่อนขั้นตอนถัดไป",{"0":formatDurationLabel(step.hours, step.minutes)}),
        removable: true,
        onRemove,
      };
    case 'gate':
      return {
        kind: 'gate',
        title: __uiText("ตรวจเงื่อนไขซ้ำ (Gate)"),
        subtitle: __uiText("ตรวจว่าตะกร้ายังไม่ว่าง/ยังไม่ชำระเงิน (cart_still_open) ก่อนทำขั้นตอนถัดไป"),
        removable: true,
        onRemove,
      };
    case 'action': {
      const { title, subtitle } = describeAction(step, coupons);
      return { kind: 'action', title, subtitle, removable: true, onRemove };
    }
    case 'condition':
      return {
        kind: 'condition',
        title: describeCondition(step),
        subtitle: '',
        removable: true,
        onRemove,
      };
  }
}

function stepExplicitNextId(step: MarketingStep): string | null | undefined {
  if (
    step.type === 'audience' ||
    step.type === 'wait' ||
    step.type === 'gate' ||
    step.type === 'action'
  ) {
    return step.nextId;
  }
  return undefined;
}

function buildCanvasEdges(steps: MarketingStep[]): Edge[] {
  const stepIds = new Set(steps.map((s) => s.id));
  const edges: Edge[] = [];

  if (steps.length > 0) {
    edges.push({
      id: `${TRIGGER_NODE_ID}->${steps[0].id}`,
      source: TRIGGER_NODE_ID,
      target: steps[0].id,
      type: 'smoothstep',
      style: { stroke: '#d1d5db', strokeWidth: 1.5 },
    });
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === 'condition') {
      if (step.yesNextId && stepIds.has(step.yesNextId)) {
        edges.push({
          id: `${step.id}-yes->${step.yesNextId}`,
          source: step.id,
          sourceHandle: 'yes',
          target: step.yesNextId,
          type: 'smoothstep',
          label: 'Yes',
          style: { stroke: '#16a34a', strokeWidth: 1.5 },
          labelStyle: { fill: '#16a34a', fontWeight: 600, fontSize: 11 },
        });
      }
      if (step.noNextId && stepIds.has(step.noNextId)) {
        edges.push({
          id: `${step.id}-no->${step.noNextId}`,
          source: step.id,
          sourceHandle: 'no',
          target: step.noNextId,
          type: 'smoothstep',
          label: 'No',
          style: { stroke: '#dc2626', strokeWidth: 1.5 },
          labelStyle: { fill: '#dc2626', fontWeight: 600, fontSize: 11 },
        });
      }
      continue;
    }

    const explicit = stepExplicitNextId(step);
    if (explicit === null) continue;
    if (typeof explicit === 'string' && stepIds.has(explicit)) {
      edges.push({
        id: `${step.id}->${explicit}`,
        source: step.id,
        target: explicit,
        type: 'smoothstep',
        style: { stroke: '#9ca3af', strokeWidth: 1.5 },
      });
      continue;
    }

    const next = steps[i + 1];
    if (next) {
      edges.push({
        id: `${step.id}->${next.id}`,
        source: step.id,
        target: next.id,
        type: 'smoothstep',
        style: { stroke: '#d1d5db', strokeWidth: 1.5 },
      });
    }
  }

  return edges;
}

/**
 * Workaround for an @xyflow/react v12 quirk (seen on 12.11.2): node
 * measurement runs off ResizeObserver + requestAnimationFrame, and browsers
 * suspend both while `document.visibilityState === 'hidden'` (background tab,
 * embedded webview). If this editor loads in that state, nodes stay unmeasured
 * — no edges render, fitView never runs, and connection dragging is dead
 * (no handleBounds). When nodes exist but never initialize, force a measure
 * through the store directly (synchronous, no rAF), then run the fitView that
 * got swallowed.
 */
function MeasurementWatchdog() {
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const storeApi = useStoreApi();
  const [attempt, setAttempt] = useState(0);
  const kicked = useRef(false);

  useEffect(() => {
    if (nodesInitialized) {
      if (kicked.current) {
        kicked.current = false;
        fitView({ padding: 0.3, maxZoom: 1 });
      }
      return;
    }
    if (attempt >= 10) return;
    const timer = setTimeout(() => {
      const { domNode, updateNodeInternals } = storeApi.getState();
      const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: boolean }>();
      domNode?.querySelectorAll<HTMLDivElement>('.react-flow__node[data-id]').forEach((el) => {
        const id = el.getAttribute('data-id');
        if (id) updates.set(id, { id, nodeElement: el, force: true });
      });
      if (updates.size > 0) {
        kicked.current = true;
        updateNodeInternals(updates);
      }
      setAttempt((prev) => prev + 1);
    }, 100);
    return () => clearTimeout(timer);
  }, [nodesInitialized, attempt, fitView, storeApi]);

  return null;
}

export function MarketingFlowCanvas({
  triggerType,
  triggerConfig,
  schedule,
  steps,
  positions,
  segments,
  coupons,
  selectedNodeId,
  onSelectNode,
  onNodeMove,
  onDeleteStep,
  onUpdateTriggerType,
  onConnectSteps,
  onDisconnectEdge,
}: MarketingFlowCanvasProps) {
  const locale = __useUiLocale();
  const [nodes, setNodes, onNodesChange] = useNodesState<MarketingFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const stepsContentKey = JSON.stringify(steps);
  const triggerConfigKey = JSON.stringify(triggerConfig);
  const scheduleKey = JSON.stringify(schedule);

  useEffect(() => {
    const triggerNode: MarketingFlowNode = {
      id: TRIGGER_NODE_ID,
      type: 'marketingStep',
      position: positions[TRIGGER_NODE_ID] ?? { x: 0, y: 0 },
      draggable: false,
      deletable: false,
      selectable: true,
      connectable: true,
      selected: selectedNodeId === TRIGGER_NODE_ID,
      data: {
        kind: 'trigger',
        title: __uiText('Trigger: {0}', { '0': __uiText(TRIGGER_TITLE[triggerType] ?? triggerType) }),
        subtitle: `${describeTrigger(triggerType, triggerConfig)}\n${__uiText('ช่วงเวลาทำงาน: {0}', { '0': describeMarketingSchedule(schedule) })}`,
        triggerType,
        onUpdateTriggerType,
      },
    };

    const stepNodes: MarketingFlowNode[] = steps.map((step, index) => ({
      id: step.id,
      type: step.type === 'condition' ? 'marketingCondition' : 'marketingStep',
      position: positions[step.id] ?? { x: 0, y: NODE_GAP_Y * (index + 1) },
      connectable: true,
      selected: selectedNodeId === step.id,
      data: buildNodeData(step, segments, coupons, () => onDeleteStep(step.id)),
    }));

    setNodes([triggerNode, ...stepNodes]);
    setEdges(buildCanvasEdges(steps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsContentKey, triggerType, triggerConfigKey, scheduleKey, segments, coupons, onUpdateTriggerType, locale]);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    );
  }, [selectedNodeId, setNodes]);

  const handleNodeClick: NodeMouseHandler<MarketingFlowNode> = (_event, node) => {
    onSelectNode(node.id);
  };

  const handlePaneClick = () => onSelectNode(null);

  const handleNodeDragStop: NodeMouseHandler<MarketingFlowNode> = (_event, node) => {
    onNodeMove(node.id, node.position);
  };

  const applyConnection = useCallback(
    (source: string, target: string, sourceHandle?: string | null) => {
      if (!source || !target || source === target) return;
      if (target === TRIGGER_NODE_ID) return;
      onConnectSteps({ source, target, sourceHandle });
    },
    [onConnectSteps],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      applyConnection(connection.source, connection.target, connection.sourceHandle);
    },
    [applyConnection],
  );

  /** Fallback when drop lands on the card but RF rejects handle pairing (source→source). */
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      // Successful handle→handle connects already go through onConnect.
      if (!('fromNode' in state) || !state.fromNode) return;
      if (state.isValid === true) return;

      const from = state.fromNode.id;
      let to = state.toNode?.id ?? null;

      if (!to) {
        const point =
          'changedTouches' in event
            ? event.changedTouches[0]
            : (event as MouseEvent);
        if (point) {
          const el = document.elementFromPoint(point.clientX, point.clientY);
          const nodeEl = el?.closest('.react-flow__node') as HTMLElement | null;
          to = nodeEl?.getAttribute('data-id') ?? null;
        }
      }

      if (!to || to === from || to === TRIGGER_NODE_ID) return;

      const sourceHandle = state.fromHandle?.id ?? null;
      applyConnection(from, to, sourceHandle);
    },
    [applyConnection],
  );

  /**
   * Delete/Backspace on a selected node must update parent `steps` via
   * `onDeleteStep`. The default `onNodesChange` only mutates local RF state —
   * without this bridge, the node vanishes until the next rebuild/save, then
   * reappears from the still-present step.
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange<MarketingFlowNode>[]) => {
      const passthrough: NodeChange<MarketingFlowNode>[] = [];
      for (const change of changes) {
        if (change.type === 'remove') {
          if (change.id === TRIGGER_NODE_ID) continue;
          onDeleteStep(change.id);
          continue;
        }
        passthrough.push(change);
      }
      if (passthrough.length > 0) onNodesChange(passthrough);
    },
    [onDeleteStep, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          const removed = edges.find((e) => e.id === change.id);
          if (removed) {
            onDisconnectEdge({
              source: removed.source,
              target: removed.target,
              sourceHandle: removed.sourceHandle,
            });
          }
        }
      }
      onEdgesChange(changes);
    },
    [edges, onDisconnectEdge, onEdgesChange],
  );

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source) return false;
    // Allow in-progress drag (no target yet).
    if (!connection.target) return true;
    if (connection.source === connection.target) return false;
    if (connection.target === TRIGGER_NODE_ID) return false;
    return true;
  }, []);

  return (
    <div className="h-full w-full rounded-xl border border-gray-200 bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={marketingNodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        onNodeClick={handleNodeClick}
        // @xyflow/react 12.12 types onNodeDragStop as OnNodeDrag (josh is on 12.11); the handler only reads the node.
        onNodeDragStop={handleNodeDragStop as never}
        onPaneClick={handlePaneClick}
        nodesConnectable
        nodesDraggable
        edgesFocusable
        elementsSelectable
        connectionMode={ConnectionMode.Loose}
        connectionRadius={48}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{
          'controls.ariaLabel': __uiText('Workflow controls'),
          'controls.zoomIn.ariaLabel': __uiText('Zoom in'),
          'controls.zoomOut.ariaLabel': __uiText('Zoom out'),
          'controls.fitView.ariaLabel': __uiText('Fit view'),
          'controls.interactive.ariaLabel': __uiText('Toggle interactivity'),
        }}
      >
        <MeasurementWatchdog />
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="#d1d5db" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default MarketingFlowCanvas;

// ui-display-helper-migration: display descriptions; record values and enum keys remain data

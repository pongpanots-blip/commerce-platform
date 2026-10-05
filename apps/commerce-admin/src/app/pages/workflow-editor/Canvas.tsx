import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MarketingStep } from './marketing.types';

const TRIGGER_NODE_ID = 'trigger';
const NODE_GAP_Y = 170;

type CanvasProps = {
  steps: MarketingStep[];
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
  onAddStepAfter: () => void;
  onDeleteStep: (id: string) => void;
};

export function WorkflowCanvas({
  steps,
  selectedStepId,
  onSelectStep,
  onAddStepAfter,
  onDeleteStep,
}: CanvasProps) {
  const initialNodes: Node[] = [
    {
      id: TRIGGER_NODE_ID,
      data: { label: 'Trigger' },
      position: { x: 0, y: 0 },
    },
  ];

  const initialEdges: Edge[] = [];
  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);

  // Build nodes from steps
  useEffect(() => {
    const newNodes: Node[] = [
      {
        id: TRIGGER_NODE_ID,
        data: { label: 'Trigger' },
        position: { x: 0, y: 0 },
        style: {
          background: '#fff',
          border: selectedStepId === TRIGGER_NODE_ID ? '2px solid var(--accent)' : '1px solid var(--line)',
          borderRadius: '6px',
          padding: '12px',
          minWidth: '120px',
        },
      },
    ];

    let yOffset = NODE_GAP_Y;
    steps.forEach((step) => {
      newNodes.push({
        id: step.id,
        data: {
          label:
            step.type === 'action' && 'action' in step
              ? `${step.type}: ${(step.action as any).kind}`
              : step.type,
        },
        position: { x: 0, y: yOffset },
        style: {
          background: '#fff',
          border: selectedStepId === step.id ? '2px solid var(--accent)' : '1px solid var(--line)',
          borderRadius: '6px',
          padding: '12px',
          minWidth: '120px',
        },
      });
      yOffset += NODE_GAP_Y;
    });

    setNodes(newNodes);
  }, [steps, selectedStepId, setNodes]);

  // Build edges from step connections
  useEffect(() => {
    const newEdges: Edge[] = [];
    let prevId = TRIGGER_NODE_ID;

    steps.forEach((step) => {
      newEdges.push({
        id: `${prevId}-${step.id}`,
        source: prevId,
        target: step.id,
      });
      prevId = step.id;
    });

    setEdges(newEdges);
  }, [steps, setEdges]);

  const handleNodeClick = useCallback(
    (_event: any, node: Node) => {
      onSelectStep(node.id);
    },
    [onSelectStep],
  );

  return (
    <div style={{ width: '100%', height: '600px', border: '1px solid var(--line)', borderRadius: '6px', overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={handleNodeClick}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

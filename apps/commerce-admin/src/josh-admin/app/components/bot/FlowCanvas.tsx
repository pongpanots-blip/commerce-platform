import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  type Node,
  type Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BotWorkflow as BotWorkflowEntity } from '@josh/shared-api';
import styles from './FlowCanvas.module.css';

interface FlowCanvasProps {
  workflow: BotWorkflowEntity;
  selectedStepId?: string;
  onStepSelect: (stepId: string) => void;
}

const stepTypeColors: Record<string, string> = {
  message: '#3b82f6', // blue
  question: '#10b981', // green
  tool: '#f59e0b', // orange
  escalate: '#ef4444', // red
};

const NODE_GAP_X = 220;
const NODE_Y = 80;

function buildNodeLabel(step: { id: string; type: string; text?: string; toolName?: string }) {
  return (
    <div className={styles.nodeLabel}>
      <div className={styles.nodeIcon}>
        {step.type === 'message' && '💬'}
        {step.type === 'question' && '❓'}
        {step.type === 'tool' && '🔧'}
        {step.type === 'escalate' && '🚪'}
      </div>
      <div className={styles.nodeText}>
        <div className={styles.nodeId}>{step.id}</div>
        <div className={styles.nodePreview}>
          {step.text?.substring(0, 20) || step.toolName || '...'}
        </div>
      </div>
    </div>
  );
}

function stepToNode(
  step: { id: string; type: string; text?: string; toolName?: string },
  index: number,
  selectedStepId: string | undefined,
  existingPosition?: { x: number; y: number },
): Node {
  return {
    id: step.id,
    data: {
      label: buildNodeLabel(step),
    },
    position: existingPosition ?? { x: index * NODE_GAP_X, y: NODE_Y },
    style: {
      background: stepTypeColors[step.type] ?? '#6b7280',
      borderRadius: '8px',
      color: '#fff',
      padding: '10px',
      width: 'auto',
      minWidth: '120px',
      border: selectedStepId === step.id ? '3px solid #000' : '1px solid #ccc',
      cursor: 'pointer',
    },
    draggable: true,
  };
}

function buildEdges(steps: BotWorkflowEntity['steps']): Edge[] {
  const edgeList: Edge[] = [];
  if (!steps) return edgeList;

  steps.forEach((step) => {
    if (step.nextStepId) {
      edgeList.push({
        id: `${step.id}->${step.nextStepId}`,
        source: step.id,
        target: step.nextStepId,
        label: 'next',
      });
    }

    if (step.branches) {
      step.branches.forEach((branch, idx) => {
        edgeList.push({
          id: `${step.id}->branch-${idx}`,
          source: step.id,
          target: branch.nextStepId,
          label: branch.match.value || branch.match.type,
          animated: true,
        });
      });
    }
  });

  return edgeList;
}

export const FlowCanvas: React.FC<FlowCanvasProps> = ({
  workflow,
  selectedStepId,
  onStepSelect,
}) => {
  const steps = useMemo(() => workflow.steps ?? [], [workflow.steps]);

  const stepIdsKey = useMemo(() => steps.map((s) => s.id).join(','), [steps]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Keep dragged positions across step-metadata refreshes
  useEffect(() => {
    nodes.forEach((n) => {
      positionsRef.current.set(n.id, n.position);
    });
  }, [nodes]);

  // Rebuild nodes when step set changes; preserve positions for known ids
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return steps.map((step, index) => {
        const existing = prevById.get(step.id);
        const saved = positionsRef.current.get(step.id);
        return stepToNode(
          step,
          index,
          selectedStepId,
          existing?.position ?? saved,
        );
      });
    });
    setEdges(buildEdges(steps));
    // Only re-layout when membership / order of steps changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdsKey, setNodes, setEdges]);

  // Update selection border / label without resetting positions
  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => {
        const step = steps.find((s) => s.id === node.id);
        if (!step) return node;
        return {
          ...node,
          data: { label: buildNodeLabel(step) },
          style: {
            ...node.style,
            background: stepTypeColors[step.type] ?? '#6b7280',
            border: selectedStepId === step.id ? '3px solid #000' : '1px solid #ccc',
          },
        };
      }),
    );
  }, [selectedStepId, steps, setNodes]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onStepSelect(node.id);
    },
    [onStepSelect],
  );

  return (
    <div className={styles.container}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
};

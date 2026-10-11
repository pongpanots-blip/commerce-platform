import type {
  SegmentBranch,
  SegmentDefinition,
  SegmentFieldsResponse,
  SegmentFieldSummary,
} from '@josh/shared-api';
import { isSegmentBranch } from '@josh/shared-api';
import React from 'react';
import ConditionRow from './ConditionRow';
import { createEmptyGroup, createEmptyLeaf } from './segment-definition.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  branch: SegmentBranch;
  fields: SegmentFieldSummary[];
  options: SegmentFieldsResponse['options'];
  onChange: (next: SegmentBranch) => void;
  onRemove?: () => void;
  depth?: number;
};

/**
 * A card holding condition rows + nested groups, with an AND/OR toggle at
 * the top. Serializes to the `SegmentDefinition` tree in component state —
 * this (plus `ConditionRow`) is the only place that touches the tree shape;
 * the rest of the builder just renders it (Task 9 step 3).
 */
export function ConditionGroup({
  branch,
  fields,
  options,
  onChange,
  onRemove,
  depth = 0,
}: Props) {
  __useUiLocale();
  const updateChild = (index: number, next: SegmentDefinition) => {
    const children = branch.children.slice();
    children[index] = next;
    onChange({ ...branch, children });
  };

  const removeChild = (index: number) => {
    onChange({ ...branch, children: branch.children.filter((_, i) => i !== index) });
  };

  const addCondition = () => {
    onChange({
      ...branch,
      children: [...branch.children, createEmptyLeaf(fields, options)],
    });
  };

  const addGroup = () => {
    onChange({ ...branch, children: [...branch.children, createEmptyGroup()] });
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border ${
        depth === 0 ? 'border-gray-200 bg-gray-50/60' : 'border-dashed border-gray-300 bg-white'
      } p-3.5`}
      style={depth > 0 ? { marginLeft: 20 } : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => onChange({ ...branch, op: 'AND' })}
            className={`rounded-md px-3 py-1 transition-colors ${
              branch.op === 'AND' ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {__uiText("และ (AND)")}</button>
          <button
            type="button"
            onClick={() => onChange({ ...branch, op: 'OR' })}
            className={`rounded-md px-3 py-1 transition-colors ${
              branch.op === 'OR' ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {__uiText("หรือ (OR)")}</button>
        </div>

        {onRemove && depth > 0 && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-danger hover:underline"
          >
            {__uiText("ลบกลุ่มนี้")}</button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {branch.children.length === 0 && (
          <p className="text-xs text-gray-400">{__uiText("ยังไม่มีเงื่อนไขในกลุ่มนี้")}</p>
        )}

        {branch.children.map((child, index) =>
          isSegmentBranch(child) ? (
            <ConditionGroup
              key={index}
              branch={child}
              fields={fields}
              options={options}
              depth={depth + 1}
              onChange={(next) => updateChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          ) : (
            <ConditionRow
              key={index}
              leaf={child}
              fields={fields}
              options={options}
              onChange={(next) => updateChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          ),
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={addCondition}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {__uiText("+ เพิ่มเงื่อนไข")}</button>
        <button
          type="button"
          onClick={addGroup}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {__uiText("+ เพิ่มกลุ่มย่อย")}</button>
      </div>
    </div>
  );
}

export default ConditionGroup;

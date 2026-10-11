import type {
  SegmentFieldsResponse,
  SegmentFieldSummary,
  SegmentLeaf,
  SegmentOperator,
} from '@josh/shared-api';
import { Input, Select } from '@josh/shared-ui-web';
import React from 'react';
import {
  OPERATOR_LABELS,
  retargetLeafField,
  retargetLeafOperator,
  valueOptionsWithCurrent,
} from './segment-definition.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  leaf: SegmentLeaf;
  fields: SegmentFieldSummary[];
  options: SegmentFieldsResponse['options'];
  onChange: (next: SegmentLeaf) => void;
  onRemove: () => void;
};

/** Integer-column fields — the compiler now accepts a decimal against these
 * (cast to numeric), but a whole-number step keeps the input honest about
 * what the column actually stores (see segment-definition.compiler.ts). */
const INTEGER_FIELD_KEYS = new Set(['lifetime_order_count', 'order_count_90d']);

/**
 * One AND/OR condition — field select → operator select (filtered to that
 * field's allowed operators) → a value control that switches on `valueType`.
 * Emits a `SegmentLeaf`; never exposes the underlying JSON to the user
 * (Task 9 step 2).
 */
export function ConditionRow({ leaf, fields, options, onChange, onRemove }: Props) {
  __useUiLocale();
  const field = fields.find((f) => f.key === leaf.field);
  // Include the leaf's own current value(s) even if they've since dropped
  // out of the live option list (see valueOptionsWithCurrent) — otherwise a
  // stale saved value (e.g. an old cuisine group/leaf name) displays as if
  // nothing were selected, and re-saving would silently overwrite it.
  const currentValues: Array<string | number> =
    leaf.operator === 'in'
      ? Array.isArray(leaf.value)
        ? (leaf.value as Array<string | number>)
        : []
      : leaf.operator === 'between'
        ? []
        : [leaf.value as string | number];
  const valueOptions = valueOptionsWithCurrent(field, options, currentValues);

  const handleFieldChange = (nextFieldKey: string) => {
    onChange(retargetLeafField(fields, options, nextFieldKey));
  };

  const handleOperatorChange = (nextOperator: SegmentOperator) => {
    onChange(retargetLeafOperator(leaf, fields, options, nextOperator));
  };

  const renderValueControl = () => {
    if (!field) return null;

    if (leaf.operator === 'between') {
      const [from, to] = Array.isArray(leaf.value) ? leaf.value : ['', ''];
      const step = INTEGER_FIELD_KEYS.has(leaf.field) ? 1 : undefined;
      return (
        <div className="flex items-end gap-2">
          <Input
            label={__uiText("ต่ำสุด")}
            type="number"
            step={step}
            value={String(from ?? '')}
            onChange={(e) =>
              onChange({ ...leaf, value: [Number(e.target.value) || 0, to as number] })
            }
          />
          <span className="self-end pb-2.5 text-xs text-gray-400">{__uiText("ถึง")}</span>
          <Input
            label={__uiText("สูงสุด")}
            type="number"
            step={step}
            value={String(to ?? '')}
            onChange={(e) =>
              onChange({ ...leaf, value: [from as number, Number(e.target.value) || 0] })
            }
          />
        </div>
      );
    }

    if (leaf.operator === 'in') {
      const selected = Array.isArray(leaf.value) ? leaf.value.map(String) : [];

      if (valueOptions.length > 0) {
        return (
          <fieldset className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-lg border border-gray-100 p-2.5">
            <legend className="text-xs text-gray-500">{__uiText("ค่า")}</legend>
            {valueOptions.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => {
                    const next = selected.includes(opt.value)
                      ? selected.filter((v) => v !== opt.value)
                      : [...selected, opt.value];
                    onChange({ ...leaf, value: next });
                  }}
                />
                {opt.label}
              </label>
            ))}
          </fieldset>
        );
      }

      // Free-text "in" (e.g. manual_user_ids) — comma/newline separated.
      return (
        <label className="block">
          <span className="text-xs text-gray-500">{__uiText("ค่า")}</span>
          <textarea
            className="min-h-20 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            value={selected.join('\n')}
            onChange={(e) =>
              onChange({
                ...leaf,
                value: e.target.value
                  .split(/[\n,]/)
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
            placeholder={__uiText("ค่าหนึ่งบรรทัดต่อหนึ่งค่า")}
          />
          {leaf.field === 'manual_user_ids' && (
            <span className="mt-1 block text-xs text-gray-400">
              {__uiText("รับเฉพาะ user UUID เท่านั้น (ไม่ใช่อีเมลหรือรหัสลูกค้า) — บันทึกไม่ได้ถ้ามีค่าอื่นปน")}</span>
          )}
        </label>
      );
    }

    if (field.valueType === 'enum') {
      return (
        <div className="grid gap-1">
          <span className="text-xs text-gray-500">{__uiText("ค่า")}</span>
          <Select
            aria-label={__uiText("ค่า")}
            value={String(leaf.value ?? '')}
            onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          >
            {valueOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      );
    }

    if (field.valueType === 'number') {
      return (
        <Input
          label={__uiText("ค่า")}
          type="number"
          step={INTEGER_FIELD_KEYS.has(leaf.field) ? 1 : undefined}
          value={String(leaf.value ?? 0)}
          onChange={(e) => onChange({ ...leaf, value: Number(e.target.value) || 0 })}
        />
      );
    }

    if (field.valueType === 'date') {
      return (
        <Input
          label={__uiText("ค่า")}
          type="date"
          value={String(leaf.value ?? '')}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        />
      );
    }

    return (
      <Input
        label={__uiText("ค่า")}
        value={String(leaf.value ?? '')}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
      />
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-white p-2.5">
      <div className="grid gap-1">
        <span className="text-xs text-gray-500">{__uiText("ฟิลด์")}</span>
        <Select
          aria-label={__uiText("ฟิลด์")}
          value={leaf.field}
          onChange={(e) => handleFieldChange(e.target.value)}
        >
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {__uiText(f.label)}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-1">
        <span className="text-xs text-gray-500">{__uiText("เงื่อนไข")}</span>
        <Select
          aria-label={__uiText("เงื่อนไข")}
          value={leaf.operator}
          onChange={(e) => handleOperatorChange(e.target.value as SegmentOperator)}
        >
          {(field?.operators ?? []).map((op) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </option>
          ))}
        </Select>
      </div>

      <div className="min-w-[180px] flex-1">{renderValueControl()}</div>

      <button
        type="button"
        onClick={onRemove}
        className="ml-auto shrink-0 text-xs text-danger hover:underline"
      >
        {__uiText("ลบเงื่อนไข")}</button>
    </div>
  );
}

export default ConditionRow;

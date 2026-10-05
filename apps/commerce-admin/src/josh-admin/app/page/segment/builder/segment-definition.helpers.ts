import type {
  SegmentBranch,
  SegmentDefinition,
  SegmentFieldOption,
  SegmentFieldSummary,
  SegmentFieldsResponse,
  SegmentLeaf,
  SegmentOperator,
} from '@josh/shared-api';
import { isSegmentBranch } from '@josh/shared-api';

/** Thai label for every operator the field registry can expose (Task 9). */
export const OPERATOR_LABELS: Record<SegmentOperator, string> = {
  '<': 'น้อยกว่า',
  '<=': 'น้อยกว่าหรือเท่ากับ',
  '>': 'มากกว่า',
  '>=': 'มากกว่าหรือเท่ากับ',
  '=': 'เท่ากับ',
  '!=': 'ไม่เท่ากับ',
  between: 'อยู่ระหว่าง',
  in: 'อยู่ในกลุ่ม',
};

export function getField(
  fields: SegmentFieldSummary[],
  key: string,
): SegmentFieldSummary | undefined {
  return fields.find((field) => field.key === key);
}

/** Option list (label lookup) a field's `optionsSource` resolves to. */
export function optionsForField(
  field: SegmentFieldSummary | undefined,
  options: SegmentFieldsResponse['options'],
): SegmentFieldOption[] {
  if (!field?.optionsSource) return [];
  if (field.optionsSource === 'tiers') return options.tiers;
  if (field.optionsSource === 'cuisine') return options.cuisine;
  if (field.optionsSource === 'cuisine_group') return options.cuisine_group;
  return [];
}

/** `has_company` is the only boolean-shaped `enum` field with no `optionsSource`. */
const BOOLEAN_ENUM_OPTIONS: SegmentFieldOption[] = [
  { value: 'true', label: 'ใช่' },
  { value: 'false', label: 'ไม่ใช่' },
];

export function valueOptionsForField(
  field: SegmentFieldSummary | undefined,
  options: SegmentFieldsResponse['options'],
): SegmentFieldOption[] {
  if (!field) return [];
  if (field.optionsSource) return optionsForField(field, options);
  if (field.valueType === 'enum') return BOOLEAN_ENUM_OPTIONS;
  return [];
}

/**
 * `valueOptionsForField` only reflects the field's *current* live option
 * list — a leaf saved earlier can hold a value that has since dropped out
 * of it (e.g. a `cuisine` leaf saved with a level-0/1 name before options
 * were restricted to leaf cuisines, or a tier/cuisine_group later
 * deactivated). Without this, the select/checkbox for that leaf silently
 * shows/checks nothing recognizable while the leaf still holds the old
 * value — an admin could re-save over it without ever seeing what it was.
 * Appends any current value missing from the live list as an extra,
 * clearly-marked option so it displays truthfully instead.
 */
export function valueOptionsWithCurrent(
  field: SegmentFieldSummary | undefined,
  options: SegmentFieldsResponse['options'],
  currentValues: Array<string | number>,
): SegmentFieldOption[] {
  const base = valueOptionsForField(field, options);

  // Only fields actually backed by a discrete option list (`optionsSource`,
  // or the fixed `has_company` boolean enum) can have a "stale" value worth
  // surfacing — `valueOptionsForField` always returns [] for a free-text
  // field (`manual_user_ids`, or `custype`/`role` used with `in`), and
  // those are genuinely free text, not a value that dropped out of some
  // list. Appending every typed value there flips ConditionRow's `in`
  // control from a textarea to a checkbox list as soon as one value exists
  // (`valueOptions.length > 0` is what selects that branch) — can't type a
  // second id, and a saved manual_user_ids/custype segment reopens showing
  // checkboxes instead of its textarea.
  const hasOptionList = Boolean(field?.optionsSource) || field?.valueType === 'enum';
  if (!hasOptionList) return base;

  const known = new Set(base.map((o) => o.value));
  const missing = [
    ...new Set(
      currentValues.map((v) => String(v)).filter((v) => v !== '' && !known.has(v)),
    ),
  ];
  if (missing.length === 0) return base;
  return [
    ...base,
    ...missing.map((v) => ({ value: v, label: `${v} (ค่าเดิม ไม่อยู่ในตัวเลือกปัจจุบัน)` })),
  ];
}

function defaultValueForField(
  field: SegmentFieldSummary | undefined,
  operator: SegmentOperator,
  options: SegmentFieldsResponse['options'],
): SegmentLeaf['value'] {
  if (!field) return '';
  if (operator === 'between') return field.valueType === 'number' ? [0, 0] : ['', ''];
  if (operator === 'in') {
    const opts = valueOptionsForField(field, options);
    return opts.length > 0 ? [opts[0].value] : [];
  }
  if (field.valueType === 'number') return 0;
  const opts = valueOptionsForField(field, options);
  if (opts.length > 0) return opts[0].value;
  return '';
}

/** A brand-new leaf for the first field in the registry (or a given field). */
export function createEmptyLeaf(
  fields: SegmentFieldSummary[],
  options: SegmentFieldsResponse['options'],
  fieldKey?: string,
): SegmentLeaf {
  const field = fieldKey ? getField(fields, fieldKey) : fields[0];
  const operator: SegmentOperator = field?.operators[0] ?? '=';
  return {
    field: field?.key ?? '',
    operator,
    value: defaultValueForField(field, operator, options),
  };
}

export function createEmptyGroup(op: SegmentBranch['op'] = 'AND'): SegmentBranch {
  return { op, children: [] };
}

/** Re-derives operator + a sane default value when the field select changes. */
export function retargetLeafField(
  fields: SegmentFieldSummary[],
  options: SegmentFieldsResponse['options'],
  nextFieldKey: string,
): SegmentLeaf {
  const field = getField(fields, nextFieldKey);
  const operator: SegmentOperator = field?.operators[0] ?? '=';
  return {
    field: nextFieldKey,
    operator,
    value: defaultValueForField(field, operator, options),
  };
}

/** Re-derives a sane default value when the operator select changes. */
export function retargetLeafOperator(
  leaf: SegmentLeaf,
  fields: SegmentFieldSummary[],
  options: SegmentFieldsResponse['options'],
  nextOperator: SegmentOperator,
): SegmentLeaf {
  const field = getField(fields, leaf.field);
  return {
    ...leaf,
    operator: nextOperator,
    value: defaultValueForField(field, nextOperator, options),
  };
}

function formatSingleValue(
  field: SegmentFieldSummary | undefined,
  value: string | number,
  options: SegmentFieldsResponse['options'],
): string {
  if (!field) return String(value);
  if (field.valueType === 'enum') {
    const opt = valueOptionsForField(field, options).find(
      (o) => o.value === String(value),
    );
    return opt?.label ?? String(value);
  }
  return String(value);
}

function formatLeafValue(
  field: SegmentFieldSummary | undefined,
  leaf: SegmentLeaf,
  options: SegmentFieldsResponse['options'],
): string {
  if (leaf.operator === 'between' && Array.isArray(leaf.value)) {
    const [from, to] = leaf.value;
    return `${formatSingleValue(field, from as string | number, options)} ถึง ${formatSingleValue(
      field,
      to as string | number,
      options,
    )}`;
  }
  if (leaf.operator === 'in' && Array.isArray(leaf.value)) {
    return leaf.value
      .map((v) => formatSingleValue(field, v as string | number, options))
      .join(', ');
  }
  return formatSingleValue(field, leaf.value as string | number, options);
}

/** Renders one leaf as a Thai clause, e.g. "ยอดใช้จ่ายสะสม น้อยกว่า 1,000". */
export function describeLeaf(
  leaf: SegmentLeaf,
  fields: SegmentFieldSummary[],
  options: SegmentFieldsResponse['options'],
): string {
  const field = getField(fields, leaf.field);
  const label = field?.label ?? leaf.field;
  const operatorLabel = OPERATOR_LABELS[leaf.operator] ?? leaf.operator;
  const valueLabel = formatLeafValue(field, leaf, options);
  return `${label} ${operatorLabel} ${valueLabel}`;
}

/**
 * Renders the whole tree as one Thai sentence — the plain-language summary
 * (Task 9 step 5) so non-technical marketing users can trust what they built
 * without ever seeing the underlying JSON.
 */
export function describeDefinition(
  def: SegmentDefinition | null | undefined,
  fields: SegmentFieldSummary[],
  options: SegmentFieldsResponse['options'],
): string {
  if (!def) return 'ยังไม่ได้ตั้งเงื่อนไข';

  if (isSegmentBranch(def)) {
    if (def.children.length === 0) return 'ยังไม่ได้ตั้งเงื่อนไขในกลุ่มนี้';
    const joiner = def.op === 'AND' ? ' และ ' : ' หรือ ';
    const parts = def.children.map((child) => {
      const text = describeDefinition(child, fields, options);
      return isSegmentBranch(child) ? `(${text})` : text;
    });
    return parts.join(joiner);
  }

  return describeLeaf(def, fields, options);
}

/**
 * Drops empty branch nodes (a group with no rows/sub-groups yet — a normal
 * mid-edit state in the builder) before the tree is sent to
 * `previewSegment`/save. The backend compiler rejects a branch with zero
 * children outright, so an empty group must never reach the API.
 */
export function pruneEmptyBranches(
  def: SegmentDefinition | null | undefined,
): SegmentDefinition | null {
  if (!def) return null;
  if (!isSegmentBranch(def)) return def;

  const children = def.children
    .map((child) => pruneEmptyBranches(child))
    .filter((child): child is SegmentDefinition => child != null);

  if (children.length === 0) return null;
  return { op: def.op, children };
}

export type SegmentPreset = {
  id: string;
  label: string;
  build: () => SegmentDefinition;
};

/**
 * Task 9 step 6 — one-click starting points for common marketing asks.
 * Each preset builds a single-condition tree the admin can still edit
 * further in the builder.
 */
export const SEGMENT_PRESETS: SegmentPreset[] = [
  {
    id: 'about-to-churn',
    label: 'ลูกค้าใกล้หาย',
    build: () => ({
      field: 'last_order_days_ago',
      operator: '>=',
      value: 60,
    }),
  },
  {
    id: 'new-30d',
    label: 'ลูกค้าใหม่ 30 วัน',
    build: () => ({
      field: 'registered_days_ago',
      operator: '<=',
      value: 30,
    }),
  },
  {
    id: 'vip',
    label: 'นักช้อป VIP',
    build: () => ({
      field: 'tier',
      operator: 'in',
      value: ['gold', 'platinum'],
    }),
  },
  {
    id: 'low-spend',
    label: 'ยอดต่ำกว่า ฿1,000',
    build: () => ({
      field: 'lifetime_spend',
      operator: '<',
      value: 1000,
    }),
  },
];

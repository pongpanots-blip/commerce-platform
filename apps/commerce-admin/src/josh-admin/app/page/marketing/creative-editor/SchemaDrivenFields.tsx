import { ELEMENT_FIELD_SCHEMA } from '@josh/shared-api';
import { Select } from '@josh/shared-ui-web';
import type {
  CreativeElement,
  CreativeI18nOverlay,
  FieldDescriptor,
  InspectorFieldGroup,
} from './creative-editor.types';

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-primary focus:outline-none disabled:bg-gray-50 disabled:text-gray-400';
const LABEL_CLASS = 'mb-1 block text-[10px] font-medium text-gray-500';

type SchemaElementType = keyof typeof ELEMENT_FIELD_SCHEMA;
type AccordionItem = { id: string; title: string; body: string };
type OverlayItem = { title?: string; body?: string };

export function isSchemaDrivenType(type: CreativeElement['type']): type is SchemaElementType {
  return type in ELEMENT_FIELD_SCHEMA;
}

/**
 * Does this element type have any descriptor in the given inspector section?
 * The inspector uses it to omit a section rather than render an empty one.
 */
export function hasSchemaFieldsInGroup(
  type: CreativeElement['type'],
  group: InspectorFieldGroup,
): boolean {
  if (!isSchemaDrivenType(type)) return false;
  return ELEMENT_FIELD_SCHEMA[type].some((d) => (d.group ?? 'content') === group);
}

/**
 * Which descriptor keys carry translatable copy, per element type.
 *
 * `product_grid` is intentionally empty: its fields are a data query (source,
 * column count, price/badge flags), not copy — the product names and prices it
 * renders are translated by the product catalogue, not by this overlay.
 */
const TRANSLATABLE_KEYS: Record<SchemaElementType, string[]> = {
  product_grid: [],
  rich_text: ['html'],
  accordion: ['items'],
};

/** Read `a.b.c` off an element, returning undefined for any missing hop. */
export function getFieldValue(element: CreativeElement, key: string): unknown {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, element as unknown);
}

/**
 * Build the minimal patch that sets `key` to `value`. Nested keys re-emit the
 * whole owning object because `patchElement` does a shallow merge.
 */
export function setFieldValue(
  element: CreativeElement,
  key: string,
  value: unknown,
): Partial<CreativeElement> {
  const [head, ...rest] = key.split('.');
  if (rest.length === 0) return { [head]: value } as Partial<CreativeElement>;

  const owner = (element as unknown as Record<string, unknown>)[head];
  const base = owner && typeof owner === 'object' ? { ...(owner as Record<string, unknown>) } : {};

  let cursor = base;
  for (let index = 0; index < rest.length - 1; index += 1) {
    const segment = rest[index];
    const next = cursor[segment];
    cursor[segment] =
      next && typeof next === 'object' ? { ...(next as Record<string, unknown>) } : {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[rest[rest.length - 1]] = value;

  return { [head]: base } as Partial<CreativeElement>;
}

function isVisible(element: CreativeElement, descriptor: FieldDescriptor): boolean {
  if (!descriptor.visibleWhen) return true;
  return getFieldValue(element, descriptor.visibleWhen.key) === descriptor.visibleWhen.equals;
}

function fieldId(element: CreativeElement, key: string): string {
  return `field-${element.id}-${key.replace(/\./g, '-')}`;
}

function isAccordionItems(value: unknown): value is AccordionItem[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object');
}

/**
 * Full `product_grid.source` for a newly selected kind. Switching kind via
 * `setFieldValue('source.kind', …)` would only overwrite `kind` and leave
 * sibling fields (e.g. `skus`) undefined — which crashes the canvas preview.
 */
function defaultProductGridSource(
  kind: string,
): Extract<CreativeElement, { type: 'product_grid' }>['source'] {
  switch (kind) {
    case 'skus':
      return { kind: 'skus', skus: [] };
    case 'category':
      return { kind: 'category', categoryId: '', limit: 8 };
    case 'promotion':
    default:
      return { kind: 'promotion' };
  }
}

/** Base-language editor for accordion items: add / remove / edit title + body. */
function ItemListControl({
  items,
  onChange,
}: {
  items: AccordionItem[];
  onChange: (next: AccordionItem[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <div key={item.id ?? index} className="space-y-1 rounded border border-gray-200 p-1.5">
          <div className="flex items-center gap-1">
            <input
              aria-label={`หัวข้อที่ ${index + 1}`}
              className={`${INPUT_CLASS} flex-1`}
              placeholder="หัวข้อ"
              value={item.title ?? ''}
              onChange={(event) => {
                const next = [...items];
                next[index] = { ...item, title: event.target.value };
                onChange(next);
              }}
            />
            <button
              type="button"
              aria-label={`ลบหัวข้อที่ ${index + 1}`}
              className="shrink-0 px-1 text-red-400 hover:text-red-600"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <textarea
            aria-label={`รายละเอียดของหัวข้อที่ ${index + 1}`}
            rows={2}
            className={INPUT_CLASS}
            placeholder="รายละเอียด"
            value={item.body ?? ''}
            onChange={(event) => {
              const next = [...items];
              next[index] = { ...item, body: event.target.value };
              onChange(next);
            }}
          />
        </div>
      ))}
      <button
        type="button"
        className="w-full rounded border border-dashed border-gray-300 py-1.5 text-[11px] text-gray-500 hover:bg-gray-50"
        onClick={() => onChange([...items, { id: crypto.randomUUID(), title: 'หัวข้อ', body: '' }])}
      >
        + เพิ่มหัวข้อ
      </button>
    </div>
  );
}

/**
 * Translation editor for accordion items. Overlays are positional, so the item
 * count is fixed by the Thai base — no add/remove here, only per-slot copy.
 */
function ItemListTranslateControl({
  baseItems,
  overlayItems,
  onChange,
}: {
  baseItems: AccordionItem[];
  overlayItems: OverlayItem[];
  onChange: (next: OverlayItem[]) => void;
}) {
  const write = (index: number, patch: OverlayItem) => {
    const next: OverlayItem[] = Array.from(
      { length: Math.max(index + 1, baseItems.length, overlayItems.length) },
      (_, i) => ({ ...(overlayItems[i] ?? {}) }),
    ).slice(0, Math.max(baseItems.length, index + 1));
    next[index] = { ...next[index], ...patch };
    for (const item of next) {
      for (const key of Object.keys(item) as Array<keyof OverlayItem>) {
        if (!item[key]?.trim()) delete item[key];
      }
    }
    onChange(next);
  };

  if (baseItems.length === 0) {
    return <p className="text-[10px] text-gray-400">ยังไม่มีหัวข้อในภาษาไทย</p>;
  }

  return (
    <div className="space-y-1.5">
      {baseItems.map((item, index) => (
        <div key={item.id ?? index} className="space-y-1 rounded border border-gray-200 p-1.5">
          <input
            aria-label={`หัวข้อที่ ${index + 1}`}
            className={INPUT_CLASS}
            placeholder={item.title || 'หัวข้อ'}
            value={overlayItems[index]?.title ?? ''}
            onChange={(event) => write(index, { title: event.target.value })}
          />
          <textarea
            aria-label={`รายละเอียดของหัวข้อที่ ${index + 1}`}
            rows={2}
            className={INPUT_CLASS}
            placeholder={item.body || 'รายละเอียด'}
            value={overlayItems[index]?.body ?? ''}
            onChange={(event) => write(index, { body: event.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

function StringListControl({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: unknown;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <textarea
      id={id}
      rows={4}
      disabled={disabled}
      className={`${INPUT_CLASS} font-mono`}
      placeholder={'SKU001\nSKU002'}
      value={Array.isArray(value) ? (value as string[]).join('\n') : ''}
      onChange={(event) =>
        onChange(
          event.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        )
      }
    />
  );
}

function FieldControl({
  element,
  descriptor,
  disabled,
  onPatch,
}: {
  element: CreativeElement;
  descriptor: FieldDescriptor;
  disabled: boolean;
  onPatch: (patch: Partial<CreativeElement>) => void;
}) {
  const id = fieldId(element, descriptor.key);
  const value = getFieldValue(element, descriptor.key);
  const emit = (next: unknown) => onPatch(setFieldValue(element, descriptor.key, next));

  switch (descriptor.control) {
    case 'textarea':
      return (
        <textarea
          id={id}
          rows={5}
          disabled={disabled}
          className={`${INPUT_CLASS} font-mono`}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => emit(event.target.value)}
        />
      );
    case 'number':
      return (
        <input
          id={id}
          type="number"
          disabled={disabled}
          className={INPUT_CLASS}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => emit(Number(event.target.value) || 0)}
        />
      );
    case 'select':
      return (
        <Select
          id={id}
          disabled={disabled}
          className="w-full"
          value={value == null ? '' : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            // Kind switch must replace the whole source object — a nested kind-only
            // patch leaves skus/categoryId/limit missing and crashes the preview.
            if (descriptor.key === 'source.kind') {
              onPatch({ source: defaultProductGridSource(raw) } as Partial<CreativeElement>);
              return;
            }
            // Numeric option values (product_grid columns) must stay numbers —
            // the schema types them as 2 | 3 | 4, and the renderer does maths on them.
            emit(/^\d+$/.test(raw) ? Number(raw) : raw);
          }}
        >
          {(descriptor.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    case 'toggle':
      return (
        <input
          id={id}
          type="checkbox"
          disabled={disabled}
          checked={value === true}
          onChange={(event) => emit(event.target.checked)}
        />
      );
    case 'color':
      return (
        <input
          id={id}
          type="color"
          disabled={disabled}
          className="h-8 w-full cursor-pointer rounded border border-gray-200 bg-white p-0.5"
          value={/^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? String(value) : '#000000'}
          onChange={(event) => emit(event.target.value)}
        />
      );
    case 'list':
      // Dispatch on the field, not the runtime shape: `isAccordionItems([])` is
      // true for any empty array, so shape-sniffing would misclassify an empty
      // string list. `items` is the only `control: 'list'` field today (see
      // ELEMENT_FIELD_SCHEMA) — if a second one is added, extend this list.
      if (descriptor.key === 'items' && isAccordionItems(value)) {
        return <ItemListControl items={value} onChange={emit} />;
      }
      return <StringListControl id={id} value={value} disabled={disabled} onChange={emit} />;
    case 'sku-picker':
      return <StringListControl id={id} value={value} disabled={disabled} onChange={emit} />;
    case 'category-picker':
      return (
        <input
          id={id}
          type="text"
          disabled={disabled}
          className={`${INPUT_CLASS} font-mono`}
          placeholder="category id จากหน้า Categories"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => emit(event.target.value)}
        />
      );
    case 'text':
    default:
      return (
        <input
          id={id}
          type="text"
          disabled={disabled}
          className={INPUT_CLASS}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => emit(event.target.value)}
        />
      );
  }
}

/** Overlay-writing control for the translatable descriptors of a page element. */
function TranslateControl({
  element,
  descriptor,
  overlay,
  onPatchOverlay,
}: {
  element: CreativeElement;
  descriptor: FieldDescriptor;
  overlay: CreativeI18nOverlay;
  onPatchOverlay: (patch: Partial<CreativeI18nOverlay>) => void;
}) {
  const id = fieldId(element, descriptor.key);

  if (descriptor.key === 'items') {
    const baseItems = (getFieldValue(element, 'items') ?? []) as AccordionItem[];
    return (
      <ItemListTranslateControl
        baseItems={baseItems}
        overlayItems={overlay.items ?? []}
        onChange={(next) => onPatchOverlay({ items: next })}
      />
    );
  }

  const base = getFieldValue(element, descriptor.key);
  const overlayValue = overlay[descriptor.key as keyof CreativeI18nOverlay];
  return (
    <textarea
      id={id}
      rows={5}
      className={`${INPUT_CLASS} font-mono`}
      placeholder={typeof base === 'string' ? base : ''}
      value={typeof overlayValue === 'string' ? overlayValue : ''}
      onChange={(event) => onPatchOverlay({ [descriptor.key]: event.target.value } as Partial<CreativeI18nOverlay>)}
    />
  );
}

/**
 * Inspector form generated from `ELEMENT_FIELD_SCHEMA` — used by the three page
 * element types (`product_grid`, `rich_text`, `accordion`). The ten pre-existing
 * types keep their hand-written blocks in `ElementInspector`.
 *
 * In translation mode (`editorLocale !== 'th'`) the form follows the same
 * base-vs-overlay split as the rest of the inspector: translatable fields write
 * to `design.i18n[locale]`, everything else is shown read-only so an EN edit can
 * never fork the layout.
 */
export function SchemaDrivenFields({
  element,
  onPatch,
  translating = false,
  overlay,
  onPatchOverlay,
  group,
}: {
  element: CreativeElement;
  onPatch: (patch: Partial<CreativeElement>) => void;
  translating?: boolean;
  overlay?: CreativeI18nOverlay;
  onPatchOverlay?: (patch: Partial<CreativeI18nOverlay>) => void;
  /**
   * Render only the descriptors belonging to this inspector section
   * (descriptors default to `'content'`). Omit to render all of them —
   * which is what a consumer without collapsible sections gets.
   */
  group?: InspectorFieldGroup;
}) {
  if (!isSchemaDrivenType(element.type)) return null;
  const descriptors = ELEMENT_FIELD_SCHEMA[element.type].filter(
    (descriptor) => !group || (descriptor.group ?? 'content') === group,
  );
  const translatable = TRANSLATABLE_KEYS[element.type];
  const canTranslate = translating && Boolean(onPatchOverlay);

  if (group && descriptors.length === 0 && !(group === 'content' && canTranslate)) return null;

  return (
    <div className="space-y-2">
      {canTranslate && translatable.length === 0 && group !== 'style' && (
        <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-500">
          องค์ประกอบนี้ไม่มีข้อความให้แปล — ตั้งค่าได้ในโหมดภาษาไทยเท่านั้น
        </p>
      )}
      {descriptors
        .filter((descriptor) => isVisible(element, descriptor))
        .map((descriptor) => {
          const isTranslatableField = canTranslate && translatable.includes(descriptor.key);
          return (
            <div key={descriptor.key}>
              {/* ItemListControl's rows use aria-label, not a matching id — so this
                  label has nothing to point at; render it unassociated instead of
                  wiring htmlFor to a nonexistent element. */}
              <label
                className={LABEL_CLASS}
                htmlFor={descriptor.control === 'list' ? undefined : fieldId(element, descriptor.key)}
              >
                {descriptor.label}
              </label>
              {isTranslatableField ? (
                <TranslateControl
                  element={element}
                  descriptor={descriptor}
                  overlay={overlay ?? {}}
                  onPatchOverlay={onPatchOverlay as (patch: Partial<CreativeI18nOverlay>) => void}
                />
              ) : (
                <FieldControl
                  element={element}
                  descriptor={descriptor}
                  disabled={canTranslate}
                  onPatch={onPatch}
                />
              )}
            </div>
          );
        })}
    </div>
  );
}

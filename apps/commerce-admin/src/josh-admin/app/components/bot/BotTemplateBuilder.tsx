// ui-metadata-migration: static labels and UI notices only
import { useMemo, useState } from 'react';
import { Input, Select } from '@josh/shared-ui-web';
import type { BotTemplateCTA, BotTemplateField, BotTemplateSchema } from '@josh/shared-api';
import CardTemplatePreview from './CardTemplatePreview';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const TYPE_OPTIONS = [
  { value: 'card', get label(){return __uiText("card");} },
  { value: 'card_list', get label(){return __uiText("card_list");} },
  { value: 'text', get label(){return __uiText("text");} },
  { value: 'rich_text', get label(){return __uiText("rich_text");} },
];

const FORMAT_OPTIONS = [
  { value: 'text', get label(){return __uiText("text");} },
  { value: 'image', get label(){return __uiText("image");} },
  { value: 'price', get label(){return __uiText("price");} },
  { value: 'badge', get label(){return __uiText("badge");} },
  { value: 'date', get label(){return __uiText("date");} },
  { value: 'list', get label(){return __uiText("list");} },
];

const IMAGE_SIZE_OPTIONS = [
  { value: 'sm', get label(){return __uiText("เล็ก (S)");} },
  { value: 'md', get label(){return __uiText("กลาง (M)");} },
  { value: 'lg', get label(){return __uiText("ใหญ่ (L)");} },
];

const CTA_TYPE_OPTIONS = [
  { value: 'navigate', get label(){return __uiText("navigate (ลิงก์)");} },
  { value: 'action', get label(){return __uiText("action");} },
];

export interface BotTemplateFormValue {
  name: string;
  type: 'card' | 'card_list' | 'text' | 'rich_text';
  schemaText: string;
  exampleText: string;
  active: boolean;
}

type Props = {
  value: BotTemplateFormValue;
  onChange: (value: BotTemplateFormValue) => void;
  schemaError?: string;
  exampleError?: string;
};

function safeParseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function emptyField(): BotTemplateField {
  return { label: '', key: '', format: 'text', visible: true };
}

function emptyCta(): BotTemplateCTA {
  return { label: '', type: 'navigate', url: '' };
}

const BotTemplateBuilder = ({ value, onChange, schemaError, exampleError }: Props) => {
  __useUiLocale();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const schema = useMemo(
    () => safeParseJson<BotTemplateSchema>(value.schemaText, { fields: [] }),
    [value.schemaText],
  );
  const example = useMemo(
    () => safeParseJson<Record<string, unknown>>(value.exampleText, {}),
    [value.exampleText],
  );

  const isCardType = value.type === 'card' || value.type === 'card_list';
  const fields = schema.fields ?? [];
  const ctas = schema.cta ?? [];

  const patchSchema = (next: BotTemplateSchema) => {
    onChange({
      ...value,
      schemaText: JSON.stringify(next, null, 2),
    });
  };

  const patchExample = (next: Record<string, unknown>) => {
    onChange({
      ...value,
      exampleText: JSON.stringify(next, null, 2),
    });
  };

  const updateField = (index: number, patch: Partial<BotTemplateField>) => {
    const nextFields = fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
    patchSchema({ ...schema, fields: nextFields });
  };

  const moveField = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    patchSchema({ ...schema, fields: next });
  };

  const removeField = (index: number) => {
    patchSchema({ ...schema, fields: fields.filter((_, i) => i !== index) });
  };

  const addField = () => {
    patchSchema({ ...schema, fields: [...fields, emptyField()] });
  };

  const updateCta = (index: number, patch: Partial<BotTemplateCTA>) => {
    const next = ctas.map((c, i) => (i === index ? { ...c, ...patch } : c));
    patchSchema({ ...schema, cta: next });
  };

  const removeCta = (index: number) => {
    patchSchema({ ...schema, cta: ctas.filter((_, i) => i !== index) });
  };

  const addCta = () => {
    patchSchema({ ...schema, cta: [...ctas, emptyCta()] });
  };

  /** Example value for a single card (or first card_list item) */
  const exampleItem: Record<string, unknown> =
    value.type === 'card_list' && Array.isArray((example as { items?: unknown }).items)
      ? (((example as { items: Record<string, unknown>[] }).items[0] as Record<
          string,
          unknown
        >) ?? {})
      : example;

  const setExampleFieldValue = (key: string, val: string) => {
    if (value.type === 'card_list') {
      const items = Array.isArray((example as { items?: unknown }).items)
        ? [...(example as { items: Record<string, unknown>[] }).items]
        : [{}];
      if (!items[0]) items[0] = {};
      items[0] = { ...items[0], [key]: val };
      patchExample({ ...example, items });
      return;
    }
    patchExample({ ...example, [key]: val });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div>
          <Input
            label={__uiText("ชื่อ Template")}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder={__uiText("เช่น product_card")}
          />
        </div>

        <div>
          <Select
            label={__uiText("ประเภท Template (Type)")}
            data={TYPE_OPTIONS}
            value={value.type}
            onChange={(e) =>
              onChange({
                ...value,
                type: e.target.value as BotTemplateFormValue['type'],
              })
            }
          />
        </div>

        {isCardType && (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">{__uiText("Fields")}</label>
                <button
                  type="button"
                  onClick={addField}
                  className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800"
                >
                  {__uiText("+ เพิ่ม field")}</button>
              </div>
              <div className="flex flex-col gap-3">
                {fields.length === 0 && (
                  <p className="text-xs text-gray-400">{__uiText("ยังไม่มี field — กดเพิ่ม field")}</p>
                )}
                {fields.map((field, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-500">
                        {__uiText("Field ")}{index + 1}
                      </span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs"
                          onClick={() => moveField(index, -1)}
                          disabled={index === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs"
                          onClick={() => moveField(index, 1)}
                          disabled={index === fields.length - 1}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-xs text-red-600"
                          onClick={() => removeField(index)}
                        >
                          {__uiText("ลบ")}</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Input
                          label={__uiText("ชื่อฟิลด์ที่แสดง (Label)")}
                          value={field.label}
                          onChange={(e) => updateField(index, { label: e.target.value })}
                          placeholder={__uiText("ชื่อสินค้า")}
                        />
                      </div>
                      <div>
                        <Input
                          label={__uiText("คีย์ข้อมูล (Key)")}
                          value={field.key}
                          onChange={(e) => updateField(index, { key: e.target.value })}
                          placeholder={__uiText("productName")}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Select
                          label={__uiText("รูปแบบการแสดงผล (Format)")}
                          data={FORMAT_OPTIONS}
                          value={field.format ?? 'text'}
                          onChange={(e) =>
                            updateField(index, {
                              format: e.target.value as BotTemplateField['format'],
                            })
                          }
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={field.visible !== false}
                            onChange={(e) =>
                              updateField(index, { visible: e.target.checked })
                            }
                          />
                          {__uiText("แสดงผล")}</label>
                      </div>
                    </div>
                    {field.format === 'image' && (
                      <div>
                        <Select
                          label={__uiText("ขนาดรูป")}
                          data={IMAGE_SIZE_OPTIONS}
                          value={(field.formatOptions?.size as string) ?? 'md'}
                          onChange={(e) =>
                            updateField(index, {
                              formatOptions: {
                                ...field.formatOptions,
                                size: e.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    )}
                    {field.key && (
                      <div>
                        <Input
                          label={__uiText("ค่าตัวอย่าง ({0})", {"0": field.key})}
                          value={
                            exampleItem[field.key] !== undefined &&
                            exampleItem[field.key] !== null
                              ? String(exampleItem[field.key])
                              : ''
                          }
                          onChange={(e) => setExampleFieldValue(field.key, e.target.value)}
                          placeholder={
                            field.format === 'image'
                              ? 'https://…'
                              : field.format === 'price'
                                ? '199'
                                : __uiText("ตัวอย่าง")
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {value.type === 'card_list' && (
              <div>
                <Input
                  label={__uiText("จำนวนรายการสูงสุด (maxItems)")}
                  className="max-w-[120px]"
                  type="number"
                  min={1}
                  value={schema.maxItems ?? ''}
                  onChange={(e) => {
                    const n = e.target.value === '' ? undefined : Number(e.target.value);
                    patchSchema({
                      ...schema,
                      maxItems: n && !Number.isNaN(n) ? n : undefined,
                    });
                  }}
                  placeholder={__uiText("ไม่จำกัด")}
                />
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">{__uiText("CTA ปุ่ม")}</label>
                <button
                  type="button"
                  onClick={addCta}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {__uiText("+ เพิ่มปุ่ม")}</button>
              </div>
              <div className="flex flex-col gap-3">
                {ctas.map((cta, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-gray-200 bg-white p-3 space-y-2"
                  >
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">{__uiText("CTA ")}{index + 1}</span>
                      <button
                        type="button"
                        className="text-xs text-red-600"
                        onClick={() => removeCta(index)}
                      >
                        {__uiText("ลบ")}</button>
                    </div>
                    <Input
                      label={__uiText("ข้อความบนปุ่ม (Label)")}
                      value={cta.label}
                      onChange={(e) => updateCta(index, { label: e.target.value })}
                      placeholder={__uiText("ดูสินค้า")}
                    />
                    <Select
                      label={__uiText("ประเภทปุ่ม (Type)")}
                      data={CTA_TYPE_OPTIONS}
                      value={cta.type}
                      onChange={(e) =>
                        updateCta(index, {
                          type: e.target.value as BotTemplateCTA['type'],
                        })
                      }
                    />
                    {cta.type === 'navigate' ? (
                      <Input
                        label={__uiText("ลิงก์ปลายทาง (URL)")}
                        value={cta.url ?? ''}
                        onChange={(e) => updateCta(index, { url: e.target.value })}
                        placeholder="/product/$productId"
                      />
                    ) : (
                      <Input
                        label={__uiText("ชื่อ Action")}
                        value={cta.action ?? ''}
                        onChange={(e) => updateCta(index, { action: e.target.value })}
                        placeholder={__uiText("add_to_cart")}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {!isCardType && (
          <div>
            <label htmlFor="template-example-text" className="text-sm text-gray-600">
              {__uiText("ข้อความตัวอย่าง")}</label>
            <textarea
              id="template-example-text"
              className="mt-1 w-full min-h-[80px] rounded-lg border border-gray-200 p-2 text-sm"
              value={String(example.text ?? '')}
              onChange={(e) => patchExample({ ...example, text: e.target.value })}
              placeholder={__uiText("ข้อความที่บอทจะส่ง…")}
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.active}
            onChange={(e) => onChange({ ...value, active: e.target.checked })}
          />
          {__uiText("เปิดใช้งาน (Active)")}</label>

        <div className="border-t border-gray-100 pt-3">
          <button
            type="button"
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            {advancedOpen ? '▾' : '▸'} {__uiText(" Advanced JSON")}</button>
          {advancedOpen && (
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="template-schema-json" className="text-sm text-gray-600">
                  {__uiText("โครงสร้างข้อมูล (Schema JSON)")}</label>
                <textarea
                  id="template-schema-json"
                  className="mt-1 w-full min-h-[120px] rounded-lg border border-gray-200 p-2 font-mono text-sm"
                  value={value.schemaText}
                  onChange={(e) => onChange({ ...value, schemaText: e.target.value })}
                />
                {schemaError && (
                  <p className="mt-1 text-xs text-red-500">{(typeof (schemaError) === 'string' ? __uiText(schemaError) : schemaError)}</p>
                )}
              </div>
              <div>
                <label htmlFor="template-example-json" className="text-sm text-gray-600">
                  {__uiText("ข้อมูลตัวอย่าง (Example JSON)")}</label>
                <textarea
                  id="template-example-json"
                  className="mt-1 w-full min-h-[120px] rounded-lg border border-gray-200 p-2 font-mono text-sm"
                  value={value.exampleText}
                  onChange={(e) => onChange({ ...value, exampleText: e.target.value })}
                />
                {exampleError && (
                  <p className="mt-1 text-xs text-red-500">{(typeof (exampleError) === 'string' ? __uiText(exampleError) : exampleError)}</p>
                )}
              </div>
            </div>
          )}
          {!advancedOpen && (schemaError || exampleError) && (
            <div className="mt-2">
              {schemaError && <p className="text-xs text-red-500">{(typeof (schemaError) === 'string' ? __uiText(schemaError) : schemaError)}</p>}
              {exampleError && <p className="text-xs text-red-500">{(typeof (exampleError) === 'string' ? __uiText(exampleError) : exampleError)}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <CardTemplatePreview type={value.type} schema={schema} example={example} />
      </div>
    </div>
  );
};

export default BotTemplateBuilder;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

import type { ReactNode } from 'react';
import type { BotTemplateField, BotTemplateSchema } from '@josh/shared-api';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const IMAGE_SIZE_CLASS: Record<string, string> = {
  sm: 'h-12 w-12',
  md: 'h-20 w-20',
  lg: 'h-32 w-32',
};

function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\$(\w+)/g, (_match, key) => {
    const value = data?.[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function formatValue(value: unknown, field: BotTemplateField): ReactNode {
  if (value === undefined || value === null) return null;

  switch (field.format) {
    case 'price': {
      const amount = Number(value);
      if (Number.isNaN(amount)) return String(value);
      return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: (field.formatOptions?.currency as string) ?? 'THB',
      }).format(amount);
    }
    case 'date': {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(date);
    }
    case 'badge': {
      const colorMap = field.formatOptions?.colorMap as Record<string, string> | undefined;
      const color = colorMap?.[String(value)];
      return (
        <span
          className="inline-block rounded-md px-2 py-0.5 text-[10px] font-medium text-white"
          style={{ backgroundColor: color ?? '#6b7280' }}
        >
          {String(value)}
        </span>
      );
    }
    case 'image': {
      const size = (field.formatOptions?.size as string) ?? 'md';
      const sizeClass = IMAGE_SIZE_CLASS[size] ?? IMAGE_SIZE_CLASS.md;
      return (
        // eslint-disable-next-line jsx-a11y/alt-text
        <img
          src={String(value)}
          alt={field.label}
          className={`mt-1 rounded-lg object-cover ${sizeClass}`}
        />
      );
    }
    case 'list': {
      const items = Array.isArray(value) ? value : [value];
      return (
        <ul className="mt-1 list-inside list-disc text-xs text-gray-600">
          {items.map((item, i) => (
            <li key={i}>{String(item)}</li>
          ))}
        </ul>
      );
    }
    case 'text':
    default:
      return String(value);
  }
}

type Props = {
  type: 'card' | 'card_list' | 'text' | 'rich_text';
  schema: BotTemplateSchema;
  example: Record<string, unknown>;
};

/**
 * Chat-bubble style preview mirroring shop-web ResponseCard (admin cannot import shop-web).
 */
const CardTemplatePreview = ({ type, schema, example }: Props) => {
  __useUiLocale();
  if (type === 'text' || type === 'rich_text') {
    const text = String(example?.text ?? example?.body ?? '');
    return (
      <div className="rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-800 max-w-[85%]">
        {text || <span className="text-gray-400 italic">{__uiText("ข้อความตัวอย่าง…")}</span>}
      </div>
    );
  }

  const fields = schema.fields ?? [];
  if (!fields.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-xs text-gray-400">
        {__uiText("เพิ่ม field เพื่อดูพรีวิว")}</div>
    );
  }

  const items: Record<string, unknown>[] =
    type === 'card_list'
      ? Array.isArray((example as { items?: unknown }).items)
        ? ((example as { items: Record<string, unknown>[] }).items)
        : [example]
      : [example];

  const maxItems =
    type === 'card_list' && schema.maxItems && schema.maxItems > 0
      ? schema.maxItems
      : items.length;
  const visibleItems = items.slice(0, maxItems);

  const renderCard = (data: Record<string, unknown>, key: string | number) => (
    <div
      key={key}
      className="w-full max-w-[260px] rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm"
    >
      {fields.map((field) => {
        if (field.visible === false) return null;
        const rendered = formatValue(data?.[field.key], field);
        if (rendered === null) return null;
        return (
          <div key={field.key} className="mb-1.5 text-xs last:mb-0">
            {field.format !== 'image' && (
              <span className="mr-1 font-semibold text-gray-700">{field.label}:</span>
            )}
            <span className="text-gray-600">{rendered}</span>
          </div>
        );
      })}
      {schema.cta && schema.cta.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {schema.cta.map((cta, i) => (
            <button
              key={`${cta.label}-${i}`}
              type="button"
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
              onClick={(e) => {
                e.preventDefault();
                if (cta.type === 'navigate' && cta.url) {
                  // preview only — show interpolated URL in title
                  const url = interpolate(cta.url, data);
                  // no navigation in admin preview
                  void url;
                }
              }}
            >
              {cta.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-[#e5e7eb]/40 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
        {__uiText("พรีวิวในแชท")}</div>
      {type === 'card_list' && typeof (example as { intro?: string }).intro === 'string' && (
        <div className="max-w-[85%] rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-700">
          {(example as { intro: string }).intro}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {visibleItems.map((item, i) => renderCard(item, i))}
      </div>
    </div>
  );
};

export default CardTemplatePreview;

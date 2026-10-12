import { Fragment, ReactNode, useSyncExternalStore } from 'react';
import messages from './locales/ui-messages.json';

export type UiLocale = 'th' | 'en';
const STORAGE_KEY = 'cp_ui_locale';
const subscribers = new Set<() => void>();
const catalogue = messages as Record<string, { th: string; en: string }>;
const notificationTemplates = new Map<string, { source: string; params?: Record<string, unknown> }>();

function initialLocale(): UiLocale {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'th'; }
  catch { return 'th'; }
}

let locale = initialLocale();
export const getUiLocale = () => locale;

export function setUiLocale(next: UiLocale) {
  if (next !== 'th' && next !== 'en') return;
  locale = next;
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Storage is optional. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const subscriber of subscribers) subscriber();
}

if (typeof window !== 'undefined') {
  document.documentElement.lang = locale;
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) {
      locale = event.newValue === 'en' ? 'en' : 'th';
      document.documentElement.lang = locale;
      for (const subscriber of subscribers) subscriber();
    }
  });
}

export function useUiLocale() {
  return useSyncExternalStore(callback => { subscribers.add(callback); return () => { subscribers.delete(callback); }; }, getUiLocale, () => 'th' as UiLocale);
}

/** Only UI copy is passed here; record values and API enums stay untouched. */
export function uiText(source: string, params?: Record<string, unknown>) {
  const notification = notificationTemplates.get(source);
  if (notification && notification.source !== source) return translate(notification.source, notification.params);
  return translate(source, params);
}

/** UI copy in every locale, so search matches a Thai label typed in English and vice versa. */
export function uiTextAllLocales(source: string) {
  const entry = catalogue[source] ?? catalogue[source.replace(/\s+/g, ' ').trim()];
  return entry ? `${entry.th} ${entry.en}` : source;
}

export function hasUiText(source: string) {
  const template = notificationTemplates.get(source)?.source ?? source;
  return Boolean(catalogue[template] ?? catalogue[template.replace(/\s+/g, ' ').trim()]);
}

function translate(source: string, params?: Record<string, unknown>) {
  const normalized = source.replace(/\s+/g, ' ').trim();
  const translated = catalogue[source]?.[locale] ?? catalogue[normalized]?.[locale];
  const text = translated === undefined ? source : (source.match(/^\s*/)?.[0] ?? '') + translated + (source.match(/\s*$/)?.[0] ?? '');
  const decoded = decodeUiEntities(text);
  return params ? decoded.replace(/\{(\w+)\}/g, (match, key: string) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key] ?? '') : match) : decoded;
}

// JSX entities became literal catalogue keys during migration. Decode static UI copy
// before interpolation so a record containing an entity remains exactly as supplied.
function decodeUiEntities(text: string) {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0', larr: '←', rarr: '→', middot: '·', times: '×', hellip: '…', ndash: '–', mdash: '—', ldquo: '“', rdquo: '”' };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity] ?? match;
    const point = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
  });
}

/** Keep the original message in UI state so language changes retain the current notice. */
export function formatUiMessage(source: string, params?: Record<string, unknown>) {
  const text = params ? source.replace(/\{(\w+)\}/g, (match, key: string) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key] ?? '') : match) : source;
  if (params) {
    if (notificationTemplates.size >= 200) notificationTemplates.delete(notificationTemplates.keys().next().value!);
    notificationTemplates.set(text, { source, params });
  }
  return text;
}

export function LanguageSelector({ className = '' }: { className?: string }) {
  const current = useUiLocale();
  return <label className={`inline-flex shrink-0 items-center gap-2 ${className}`}>
    <span className="sr-only">{current === 'th' ? 'ภาษา' : 'Language'}</span>
    <select aria-label={current === 'th' ? 'ภาษา' : 'Language'} value={current} onChange={event => setUiLocale(event.target.value as UiLocale)} className="min-h-10 rounded-lg border border-secondary-container bg-white px-2.5 py-2 text-xs font-medium text-on-surface focus-visible:outline-2 focus-visible:outline-primary">
      <option value="th">ไทย</option>
      <option value="en">English</option>
    </select>
  </label>;
}

/** Translate a whole sentence while keeping links, code and record values as React nodes. */
export function UiSentence({ source, values }: { source: string; values: Record<string, ReactNode> }) {
  useUiLocale();
  return <>{uiText(source).split(/(\{\w+\})/g).map((part, index) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={index}>{key && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : part}</Fragment>;
  })}</>;
}

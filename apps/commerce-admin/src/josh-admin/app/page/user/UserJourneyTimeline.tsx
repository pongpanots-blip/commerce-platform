// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  getUserAnalyticsTimeline,
  type AnalyticsPlatform,
  type AnalyticsTimelineItem,
} from '@josh/shared-api';
import { useCallback, useEffect, useMemo, useState } from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type PlatformFilter = AnalyticsPlatform | 'all';

const PLATFORM_OPTIONS: { value: PlatformFilter; label: string }[] = [
  { value: 'all', get label(){return __uiText("ทั้งหมด");} },
  { value: 'web', get label(){return __uiText("Web");} },
  { value: 'ios', get label(){return __uiText("iOS");} },
  { value: 'android', get label(){return __uiText("Android");} },
];

const PLATFORM_BADGE_STYLES: Record<string, string> = {
  web: 'border-blue-200 bg-blue-50 text-blue-700',
  ios: 'border-gray-200 bg-gray-100 text-gray-700',
  android: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const DEFAULT_RANGE_DAYS = 30;
const PAGE_SIZE = 50;

function summarize(eventName: string, payload: Record<string, unknown>): string {
  if (payload.item_id) return String(payload.item_id);
  if (payload.search_term) return String(payload.search_term);
  if (payload.transaction_id) return String(payload.transaction_id);
  if (payload.value != null) return `฿${payload.value}`;
  return eventName;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data
    ?.message;
  return message || fallback;
}

type Props = {
  userId: string;
};

export default function UserJourneyTimeline({ userId }: Props) {
  __useUiLocale();
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [items, setItems] = useState<AnalyticsTimelineItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - DEFAULT_RANGE_DAYS);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    setLoadMoreError(null);
    getUserAnalyticsTimeline(userId, {
      from: range.from,
      to: range.to,
      platform: platform === 'all' ? undefined : platform,
      limit: PAGE_SIZE,
    })
      .then((page) => {
        setItems(page.items);
        setCursor(page.next_cursor);
      })
      .catch((err) => {
        setError(errorMessage(err, 'โหลด journey timeline ไม่สำเร็จ'));
        setItems([]);
        setCursor(null);
      })
      .finally(() => setLoading(false));
  }, [userId, platform, range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    getUserAnalyticsTimeline(userId, {
      from: range.from,
      to: range.to,
      platform: platform === 'all' ? undefined : platform,
      limit: PAGE_SIZE,
      cursor,
    })
      .then((page) => {
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.next_cursor);
      })
      .catch((err) => setLoadMoreError(errorMessage(err, 'โหลดเพิ่มเติมไม่สำเร็จ')))
      .finally(() => setLoadingMore(false));
  };

  return (
    <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-gray-800">{__uiText("Journey Timeline")}</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {__uiText("เหตุการณ์ย้อนหลัง ")}{DEFAULT_RANGE_DAYS} {__uiText(" วัน · รวมทุกอุปกรณ์ที่เชื่อมโยงกับผู้ใช้นี้")}</p>
        </div>
        <div className="flex gap-1">
          {PLATFORM_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPlatform(option.value)}
              className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                platform === option.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="p-4 text-xs text-gray-400">{__uiText("กำลังโหลด...")}</p>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-xs text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p>
          <button
            type="button"
            onClick={load}
            className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-gray-50"
          >
            {__uiText("ลองใหม่")}</button>
        </div>
      ) : items.length === 0 ? (
        <p className="p-4 text-xs text-gray-400">{__uiText("ไม่มีเหตุการณ์ในช่วงที่เลือก")}</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-50">
            {items.map((item) => (
              <li
                key={item.event_id}
                className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-gray-50"
              >
                <span className="w-[130px] shrink-0 tabular-nums text-gray-500">
                  {formatDateTime(item.occurred_at)}
                </span>
                <span className="w-[160px] shrink-0 truncate font-semibold text-gray-800">
                  {item.event_name}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    PLATFORM_BADGE_STYLES[item.platform] ??
                    'border-gray-200 bg-gray-100 text-gray-600'
                  }`}
                >
                  {item.platform}
                </span>
                <span className="truncate text-gray-600">
                  {summarize(item.event_name, item.payload)}
                </span>
              </li>
            ))}
          </ul>
          {cursor && (
            <div className="border-t border-gray-100 px-4 py-2 text-center">
              {loadMoreError && (
                <p className="mb-2 text-xs text-red-600">{(typeof (loadMoreError) === 'string' ? __uiText(loadMoreError) : loadMoreError)}</p>
              )}
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
              >
                {loadingMore ? __uiText("กำลังโหลด...") : __uiText("โหลดเพิ่มเติม")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

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
import { Alert, Button, Chip, Empty, Loading, Panel, PanelHead, Segmented, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type PlatformFilter = AnalyticsPlatform | 'all';

const PLATFORM_OPTIONS: { value: PlatformFilter; label: string }[] = [
  { value: 'all', get label(){return __uiText("ทั้งหมด");} },
  { value: 'web', get label(){return __uiText("Web");} },
  { value: 'ios', get label(){return __uiText("iOS");} },
  { value: 'android', get label(){return __uiText("Android");} },
];


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

  const platformLabel = (value: string) => PLATFORM_OPTIONS.find((option) => option.value === value)?.label ?? value;

  return (
    <Panel className="overflow-hidden">
      <PanelHead
        icon="timeline"
        title={__uiText("เส้นทางการใช้งาน")}
        sub={<>{__uiText("เหตุการณ์ย้อนหลัง ")}{DEFAULT_RANGE_DAYS} {__uiText(" วัน · รวมทุกอุปกรณ์ที่เชื่อมโยงกับผู้ใช้นี้")}</>}
        actions={
          <Segmented
            value={platform}
            onChange={setPlatform}
            options={PLATFORM_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          />
        }
      />

      {loading ? (
        <Loading variant="table" />
      ) : error ? (
        <div className="p-4">
          <Alert tone="danger" actions={<Button size="sm" icon="refresh" onClick={load}>{__uiText("ลองใหม่")}</Button>}>
            {(typeof error === 'string' ? __uiText(error) : error)}
          </Alert>
        </div>
      ) : items.length === 0 ? (
        <Empty icon="timeline">{__uiText("ไม่มีเหตุการณ์ในช่วงที่เลือก")}</Empty>
      ) : (
        <>
          <ul className="divide-y divide-secondary-container">
            {items.map((item) => (
              <li
                key={item.event_id}
                className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-surface-container-low"
              >
                <span className="w-[130px] shrink-0 tabular-nums text-on-surface-variant">
                  {formatDateTime(item.occurred_at)}
                </span>
                <span className="w-[160px] shrink-0 truncate">
                  <Chip>{item.event_name}</Chip>
                </span>
                <Chip statusCode={item.platform}>{platformLabel(item.platform)}</Chip>
                <span className="truncate text-on-surface-variant">
                  {summarize(item.event_name, item.payload)}
                </span>
              </li>
            ))}
          </ul>
          {cursor && (
            <div className="border-t border-secondary-container px-4 py-2 text-center">
              {loadMoreError && (
                <p className="mb-2 text-xs text-danger">{(typeof (loadMoreError) === 'string' ? __uiText(loadMoreError) : loadMoreError)}</p>
              )}
              <Button size="sm" variant="ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? __uiText("กำลังโหลด...") : __uiText("โหลดเพิ่มเติม")}
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

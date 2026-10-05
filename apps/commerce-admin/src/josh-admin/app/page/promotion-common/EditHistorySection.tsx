import {
  formatBangkokDateTime,
  getAdminAuditLogs,
  type AdminAuditEntityType,
  type AdminAuditLogItem,
} from '@josh/shared-api';
import { Button } from '@josh/shared-ui-web';
import { useEffect, useId, useRef, useState } from 'react';
import { AiOutlineDown } from 'react-icons/ai';
import { getErrorMessage } from './error-message';
import { actionLabel, fieldLabel, formatChange, isHiddenField } from './edit-history.helpers';

type Props = {
  entityType: AdminAuditEntityType;
  entityId: string;
  /** Change this to refetch while the section is open (e.g. after a save). */
  refreshKey?: unknown;
  /** id → display name, from lists the page already loaded; unknown ids show as a short id. */
  names?: Record<string, string>;
};

/**
 * "ประวัติการแก้ไข (History)" — who changed this record, what and when (newest first).
 * Collapsed by default; the first open fetches, "โหลดเพิ่ม" appends the next page.
 * Data: GET /admin/audit-logs — docs/admin-audit-log-api.md
 */
export default function EditHistorySection({ entityType, entityId, refreshKey, names }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AdminAuditLogItem[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  // Bumped whenever page 1 is refetched, so a slower "load more" from before is dropped.
  const generation = useRef(0);
  const panelId = useId();

  // Opening, a changed refreshKey (while open) and "ลองใหม่" all refetch page 1.
  useEffect(() => {
    if (!open) return;
    generation.current += 1;
    let cancelled = false;
    void (async () => {
      try {
        const result = await getAdminAuditLogs({ entityType, entityId, page: 1 });
        if (cancelled) return;
        setItems(result.items);
        setPage(result.meta.page);
        setTotalPages(result.meta.totalPages);
        setError('');
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, 'โหลดประวัติการแก้ไขไม่สำเร็จ'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, entityType, entityId, refreshKey, retryKey]);

  const loadMore = async () => {
    const mine = generation.current;
    setLoading(true);
    try {
      const result = await getAdminAuditLogs({ entityType, entityId, page: page + 1 });
      if (mine !== generation.current) return;
      setItems((current) => [...current, ...result.items]);
      setPage(result.meta.page);
      setTotalPages(result.meta.totalPages);
    } catch (err) {
      if (mine === generation.current) setError(getErrorMessage(err, 'โหลดประวัติการแก้ไขไม่สำเร็จ'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  };

  // Handlers show the loading state themselves — setting it inside the effect would cascade renders.
  const toggle = () => {
    if (!open) setLoading(true);
    setOpen((current) => !current);
  };
  const retry = () => {
    setError('');
    setLoading(true);
    setRetryKey((key) => key + 1);
  };

  return (
    <section className="border-t border-gray-100 pt-5">
      {/* h2 like the sibling Section titles; the button inside it is the disclosure control. */}
      <h2 className="text-sm font-semibold text-gray-900">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="flex w-full items-center justify-between text-left"
        >
          <span>ประวัติการแก้ไข (History)</span>
          <AiOutlineDown
            size={16}
            aria-hidden="true"
            className={`text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>

      {/* Always in the DOM (hidden while closed) so aria-controls resolves. */}
      <div id={panelId} hidden={!open} className="mt-3 space-y-3">
        {open && (
          <>
            {error && (
              <div role="alert" className="rounded-lg bg-alert-soft p-3 text-sm text-alert">
                <p>{error}</p>
                <div className="mt-2">
                  <Button variant="secondary" text="ลองใหม่" onClick={retry} />
                </div>
              </div>
            )}
            {!error && loading && items.length === 0 && (
              <p className="text-sm text-ink-muted">กำลังโหลด...</p>
            )}
            {!error && !loading && items.length === 0 && (
              <p className="text-sm text-ink-muted">ยังไม่มีประวัติการแก้ไข</p>
            )}

            {items.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-primary-border">
                {items.map((entry) => (
                  <li key={entry.id} className="space-y-1.5 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-semibold text-ink">
                        {entry.actor_email ?? 'ไม่ระบุผู้ใช้'}
                      </span>
                      <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                        {actionLabel(entry.action)}
                      </span>
                      <time dateTime={entry.created_at} className="text-xs text-ink-muted">
                        {formatBangkokDateTime(entry.created_at, 'th')}
                      </time>
                    </div>
                    <ChangeList changes={entry.changes} names={names} />
                  </li>
                ))}
              </ul>
            )}

            {!error && page < totalPages && (
              <Button
                variant="secondary"
                text={loading ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
                disabled={loading}
                onClick={() => void loadMore()}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ChangeList({ changes, names }: { changes: AdminAuditLogItem['changes']; names?: Record<string, string> }) {
  const shown = changes.filter((change) => !isHiddenField(change.field));
  // Only internal columns changed: keep the entry (someone did save) but say so instead of listing them.
  if (shown.length === 0 && changes.length > 0) {
    return <p className="text-xs text-ink-muted">แก้ไขข้อมูลภายใน</p>;
  }
  return (
    <ul className="space-y-0.5 text-xs text-ink-secondary">
      {shown.map((change) => {
        const text = formatChange(change, names);
        return (
          <li key={change.field} className="break-words">
            <span className="font-semibold">{fieldLabel(change.field)}</span>
            {': '}
            <span className="text-ink-muted" title={JSON.stringify(change.before)}>
              {text.before}
            </span>
            {' → '}
            <span className="text-ink" title={JSON.stringify(change.after)}>
              {text.after}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

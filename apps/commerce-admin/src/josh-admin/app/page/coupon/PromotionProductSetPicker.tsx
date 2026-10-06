import {
  getPromotionProductSet,
  getPromotionProductSets,
  resolvePromotionSkus,
  type CouponProductSetSnapshot,
  type PromotionProductItem,
  type PromotionProductSetDetail,
  type PromotionProductSetSummary,
} from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { resolveProductImageUrl } from '../promotion-product-set/promotion-product-set.helpers';
import { appendReturnTo } from '../../utils/return-to';
import { useStashCouponDraftOnClick } from './coupon-form-draft.helpers';
import { diffProductSetItems, hasProductSetChanged } from './coupon-redemption.helpers';

const API_BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

type Props = {
  title: string;
  hint?: string;
  selectedIds: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Server-owned SKU snapshots keyed by set id — read-only, see coupon.api.ts */
  snapshots: Record<string, CouponProductSetSnapshot>;
  /** Set ids whose snapshot the admin has chosen to refresh from the live set on next save.
   * Pruning ids no longer referenced by include/exclude is the caller's job (a set can be
   * selected in both pickers at once — only the caller knows both lists), not this component's. */
  refreshIds: string[];
  onRefreshChange: (next: string[]) => void;
  /** Ids that stay selected but are drawn by the caller (not in `selectedIds`): shown checked and
   * disabled in the dropdown, no card drawn here. For callers with their own chips for some sets. */
  lockedIds?: string[];
  /** '_blank' opens "จัดการ Promotion Product Set" in a new tab (rel=noopener) — for forms that
   * have no draft stash to survive leaving the page. It also reloads the set list when the admin
   * comes back to this tab (dropdown open/search state is kept), so a set created there shows up. */
  manageLinkTarget?: '_blank';
};

const NO_LOCKED_IDS: string[] = [];

type SelectedEntry =
  | { kind: 'live'; id: string; liveSet: PromotionProductSetSummary; snapshot?: CouponProductSetSnapshot }
  | { kind: 'snapshot-only'; id: string; snapshot: CouponProductSetSnapshot }
  /** id ยังไม่ resolve ได้ — กำลังโหลดอยู่ หรือโหลดรายการทั้งหมดไม่สำเร็จ (ไม่ใช่ว่าชุดถูกลบ) */
  | { kind: 'unresolved'; id: string }
  /** โหลดรายการสำเร็จแล้ว แต่หา id นี้ไม่เจอ และไม่มี snapshot เก็บไว้เลย — ชุดน่าจะถูกลบไปแล้ว */
  | { kind: 'missing'; id: string };

/** Every page of the set list (limit 100) — sets are an admin-curated, low-cardinality list. */
async function fetchAllProductSets(): Promise<PromotionProductSetSummary[]> {
  const allRows: PromotionProductSetSummary[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const response = await getPromotionProductSets(page, 100, '');
    allRows.push(...response.data);
    totalPages = response.meta.totalPages || 1;
    page += 1;
  }
  return allRows;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('th-TH');
}

/** ป้ายกำกับ SKU สำหรับแสดงผล — SKU อาจว่างได้ (snapshot เก่าที่ไม่มี sku ติดมา) ใช้ id ย่อแทน */
function displaySku(item: { product_inventory_id: string; sku: string }): string {
  return item.sku || `ID ${item.product_inventory_id.slice(0, 8)}…`;
}

/** รายการอ่านอย่างเดียวของ SKU ที่ snapshot ไว้ — resolve ชื่อ/รูปผ่าน resolvePromotionSkus,
 * SKU ที่ปิดขายหรือหาไม่พบแล้วก็ยังโชว์อยู่ (พร้อมป้ายกำกับ) เพราะ snapshot คือของจริงที่คูปองใช้อยู่ —
 * แถวที่ไม่มี sku (ว่าง) ข้ามการ resolve ไปเลย แสดงด้วย id ย่อแทน */
function SnapshotItemsView({
  items,
}: {
  items: Array<{ product_inventory_id: string; sku: string }>;
}) {
  const skus = useMemo(() => items.map((item) => item.sku).filter(Boolean), [items]);
  // ไม่มี sku ให้ resolve เลย (ทุกแถวว่าง) — ไม่ต้อง fetch, เริ่มต้นเป็น "โหลดจบแล้ว" ไปเลย
  const [loading, setLoading] = useState(skus.length > 0);
  const [resolved, setResolved] = useState<{
    items: PromotionProductItem[];
    inactive: string[];
    notFound: string[];
  }>({ items: [], inactive: [], notFound: [] });
  const skuKey = skus.join('|');

  useEffect(() => {
    if (skus.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await resolvePromotionSkus(skus);
        if (!cancelled) setResolved(result);
      } catch {
        if (!cancelled) setResolved({ items: [], inactive: [], notFound: skus });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuKey]);

  if (loading) return <p className="text-xs text-gray-400">กำลังโหลดรายการ...</p>;

  const bySku = new Map(resolved.items.map((item) => [item.sku, item]));

  return (
    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-100 bg-white p-2">
      {items.map((item) => {
        const found = item.sku ? bySku.get(item.sku) : undefined;
        const label = found
          ? null
          : item.sku
            ? resolved.inactive.includes(item.sku)
              ? 'ปิดขาย'
              : 'ไม่พบ'
            : null;
        const imgUrl = resolveProductImageUrl(found?.imageUrl ?? null, API_BASE_URL);
        return (
          <div key={item.product_inventory_id} className="flex items-center gap-2 text-xs">
            {imgUrl ? (
              <img src={imgUrl} alt="" className="h-6 w-6 shrink-0 rounded border object-cover" />
            ) : (
              <span className="h-6 w-6 shrink-0 rounded border bg-gray-50" />
            )}
            <span className="text-gray-400">{displaySku(item)}</span>
            <span className="truncate text-gray-700">{found?.name ?? displaySku(item)}</span>
            {label && (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** แจ้งเตือน "ชุดนี้ถูกแก้ไขหลังบันทึกคูปอง" — โชว์เฉพาะตอน diff ระหว่าง snapshot กับล่าสุดไม่ว่างเปล่า
 * radio ควบคุม refreshIds: default ใช้รายการเดิม (ไม่อยู่ใน refreshIds), เลือกล่าสุดแล้วค่อยเติม id เข้า refreshIds
 * radioName ต้องไม่ซ้ำข้าม picker สองตัว (include/exclude) เพราะชุดเดียวกันอาจถูกเลือกทั้งคู่พร้อมกัน */
function ProductSetChangedNotice({
  id,
  radioName,
  snapshot,
  latestDetail,
  refreshIds,
  onRefreshChange,
  disabled,
}: {
  id: string;
  radioName: string;
  snapshot: CouponProductSetSnapshot;
  latestDetail: PromotionProductSetDetail;
  refreshIds: string[];
  onRefreshChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const diff = diffProductSetItems(
    snapshot.items,
    latestDetail.items.map((item) => ({
      productInventoryId: item.productInventoryId,
      sku: item.sku,
      name: item.name,
    })),
  );
  if (diff.added.length === 0 && diff.removed.length === 0) return null;

  const useLatest = refreshIds.includes(id);
  const setUseLatest = (next: boolean) => {
    onRefreshChange(
      next ? (useLatest ? refreshIds : [...refreshIds, id]) : refreshIds.filter((x) => x !== id),
    );
  };

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
      <p className="font-medium">ชุดนี้ถูกแก้ไขหลังบันทึกคูปอง</p>
      {diff.added.length > 0 && (
        <p>
          + เพิ่ม: {diff.added.map((item) => `${item.sku || item.productInventoryId.slice(0, 8)} (${item.name})`).join(', ')}
        </p>
      )}
      {diff.removed.length > 0 && (
        <p>− ลบ: {diff.removed.map(displaySku).join(', ')}</p>
      )}
      <div className="mt-1.5 flex flex-col gap-1">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={radioName}
            checked={!useLatest}
            disabled={disabled}
            onChange={() => setUseLatest(false)}
          />
          <span>ใช้รายการเดิม (บันทึกเมื่อ {formatDateTime(snapshot.snapshotted_at)})</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={radioName}
            checked={useLatest}
            disabled={disabled}
            onChange={() => setUseLatest(true)}
          />
          <span>ใช้รายการล่าสุด</span>
        </label>
      </div>
    </div>
  );
}

function SelectedSetCard({
  entry,
  disabled,
  loading,
  loadError,
  latestDetail,
  changedError,
  onRetryChanged,
  radioName,
  refreshIds,
  onRefreshChange,
  onRemove,
}: {
  entry: SelectedEntry;
  disabled?: boolean;
  loading: boolean;
  loadError: boolean;
  latestDetail?: PromotionProductSetDetail;
  changedError: boolean;
  onRetryChanged: () => void;
  radioName: string;
  refreshIds: string[];
  onRefreshChange: (next: string[]) => void;
  onRemove: () => void;
}) {
  const [viewOpen, setViewOpen] = useState(false);

  if (entry.kind === 'unresolved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
        <span>{loading ? 'กำลังโหลด…' : `ชุดสินค้า ${entry.id.slice(0, 8)}…`}</span>
        {!disabled && (
          <button type="button" onClick={onRemove} className="ml-1 text-gray-400 hover:text-red-500">
            ×
          </button>
        )}
      </span>
    );
  }

  if (entry.kind === 'missing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-600">
        <span>ไม่พบชุดสินค้า (ถูกลบ?)</span>
        {!disabled && (
          <button type="button" onClick={onRemove} className="ml-1 text-red-400 hover:text-red-600">
            ×
          </button>
        )}
      </span>
    );
  }

  if (entry.kind === 'snapshot-only') {
    const { snapshot } = entry;
    // ยังโหลดรายการชุดสินค้าทั้งหมดไม่เสร็จ/พัง — ยังไม่รู้จริง ๆ ว่าชุดนี้ถูกลบไปแล้วหรือแค่ยังโหลดไม่ถึง
    // อย่าฟันธงว่า "ถูกลบ" จนกว่าจะโหลดสำเร็จแล้วหาไม่เจอจริง
    const confirmedDeleted = !loading && !loadError;
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="font-medium text-gray-800">{snapshot.name || entry.id.slice(0, 8)}</span>
            <span className="ml-1.5 text-gray-400">({snapshot.items.length} รายการ)</span>
          </div>
          {!disabled && (
            <button type="button" onClick={onRemove} className="shrink-0 text-gray-400 hover:text-red-500">
              ×
            </button>
          )}
        </div>
        <p className="mt-1 text-gray-500">บันทึกรายการเมื่อ {formatDateTime(snapshot.snapshotted_at)}</p>
        {confirmedDeleted && (
          <p className="mt-1 text-rose-600">ชุดต้นทางถูกลบแล้ว — ใช้รายการที่บันทึกไว้</p>
        )}
        <button
          type="button"
          onClick={() => setViewOpen((prev) => !prev)}
          className="mt-1 text-blue-600 underline hover:text-blue-700"
        >
          {viewOpen ? 'ซ่อนรายการ' : 'ดูรายการ'}
        </button>
        {viewOpen && <SnapshotItemsView items={snapshot.items} />}
      </div>
    );
  }

  // kind === 'live'
  const { liveSet, snapshot } = entry;
  const changed = snapshot ? hasProductSetChanged(liveSet.updatedAt, snapshot.set_updated_at) : false;

  return (
    <div
      className={`rounded-lg border p-2.5 text-xs ${
        liveSet.isActive ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-gray-800">{liveSet.name}</span>
          <span className="ml-1.5 text-gray-400">
            ({snapshot ? snapshot.items.length : liveSet.itemCount} รายการ)
          </span>
        </div>
        {!disabled && (
          <button type="button" onClick={onRemove} className="shrink-0 text-gray-400 hover:text-red-500">
            ×
          </button>
        )}
      </div>

      {/* ข้อความ "คูปองยังใช้รายการที่บันทึกไว้" มีความหมายเฉพาะตอนมี snapshot จริง — ชุดที่ปิดใช้งานแต่ยังไม่เคย
          บันทึกเลย (เพิ่งเลือกใหม่) ให้ปล่อยให้ข้อความ "จะบันทึกรายการเมื่อกดบันทึก" ด้านล่างสื่อความหมายพอ */}
      {!liveSet.isActive && snapshot && (
        <p className="mt-1 text-amber-700">ชุดต้นทางปิดใช้งาน — คูปองยังใช้รายการที่บันทึกไว้</p>
      )}

      {snapshot ? (
        <>
          <p className="mt-1 text-gray-500">
            บันทึกรายการเมื่อ {formatDateTime(snapshot.snapshotted_at)}
          </p>
          <button
            type="button"
            onClick={() => setViewOpen((prev) => !prev)}
            className="mt-1 text-blue-600 underline hover:text-blue-700"
          >
            {viewOpen ? 'ซ่อนรายการ' : 'ดูรายการ'}
          </button>
          {viewOpen && <SnapshotItemsView items={snapshot.items} />}
          {changed &&
            (latestDetail ? (
              <ProductSetChangedNotice
                id={entry.id}
                radioName={radioName}
                snapshot={snapshot}
                latestDetail={latestDetail}
                refreshIds={refreshIds}
                onRefreshChange={onRefreshChange}
                disabled={disabled}
              />
            ) : changedError ? (
              <p className="mt-1 text-red-600">
                ตรวจสอบการเปลี่ยนแปลงไม่สำเร็จ{' '}
                <button
                  type="button"
                  onClick={onRetryChanged}
                  className="underline hover:text-red-700"
                >
                  ลองใหม่
                </button>
              </p>
            ) : (
              <p className="mt-1 text-gray-400">กำลังตรวจสอบการเปลี่ยนแปลง...</p>
            ))}
        </>
      ) : (
        <p className="mt-1 text-gray-500">จะบันทึกรายการเมื่อกดบันทึก</p>
      )}
    </div>
  );
}

/**
 * Multi-select of reusable Promotion Product Sets (dropdown + search + checkboxes),
 * selected sets shown as removable cards. Loads every page up front (limit 100) —
 * sets are an admin-curated, low-cardinality list, not a product catalog.
 *
 * Coupons store a SNAPSHOT of each referenced set's SKUs at save time (`snapshots` prop) —
 * later edits/deactivation/deletion of the live set don't affect the coupon unless the
 * admin explicitly opts into a refresh here (`refreshIds`/`onRefreshChange`), applied by
 * the server only on next save.
 */
export function PromotionProductSetPicker({
  title,
  hint,
  selectedIds,
  onChange,
  disabled,
  snapshots,
  refreshIds,
  onRefreshChange,
  lockedIds = NO_LOCKED_IDS,
  manageLinkTarget,
}: Props) {
  // radio "name" ต้องไม่ซ้ำข้าม picker สองตัว (include/exclude) — ชุดเดียวกันอาจถูกเลือกทั้งคู่พร้อมกัน
  const pickerId = React.useId();
  const location = useLocation();
  const stashDraftOnClick = useStashCouponDraftOnClick();
  const [sets, setSets] = useState<PromotionProductSetSummary[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [changedDetails, setChangedDetails] = useState<Record<string, PromotionProductSetDetail>>({});
  const [changedErrors, setChangedErrors] = useState<Record<string, boolean>>({});
  const fetchingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      try {
        setSets(await fetchAllProductSets());
        setLoadError(false);
      } catch {
        setSets([]);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // manage-link opens a new tab: refetch the list quietly when the admin returns (no loading flash,
  // dropdown/search untouched; a failed refetch keeps the list already shown).
  useEffect(() => {
    if (!manageLinkTarget) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || inFlight) return;
      inFlight = true;
      fetchAllProductSets()
        .then((rows) => !cancelled && setSets(rows))
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [manageLinkTarget]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sets;
    return sets.filter((set) => set.name.toLowerCase().includes(query));
  }, [sets, search]);

  // ids ที่หาไม่เจอในรายการที่โหลดมา ต้องแยกสามเคส: (1) มี snapshot อยู่แล้ว — ใช้ข้อมูล snapshot แสดงได้เลย
  // ไม่ต้องรอโหลด/ไม่ต้องฟันธงว่าเป็นเพราะถูกลบ; (2) ยังโหลดอยู่/โหลดพัง และไม่มี snapshot — ไม่รู้จริง ๆ ว่ามีอยู่ไหม
  // อย่าฟันธงว่า "ถูกลบ"; (3) โหลดสำเร็จแล้วแต่หาไม่เจอจริง และไม่มี snapshot — ค่อยบอกว่าน่าจะถูกลบ
  // ทุกเคสยังต้องแสดงเป็นการ์ดที่ลบได้เสมอ ไม่งั้น id ค้างอยู่ใน selectedIds แบบมองไม่เห็นและเอาออกไม่ได้
  const selectedSets = useMemo<SelectedEntry[]>(
    () =>
      selectedIds.map((id) => {
        const liveSet = sets.find((set) => set.id === id);
        const snapshot = snapshots[id];
        if (liveSet) return { kind: 'live' as const, id, liveSet, snapshot };
        if (snapshot) return { kind: 'snapshot-only' as const, id, snapshot };
        return loading || loadError
          ? { kind: 'unresolved' as const, id }
          : { kind: 'missing' as const, id };
      }),
    [selectedIds, sets, snapshots, loading, loadError],
  );

  // ชุดที่ยังอ้างอิงอยู่ + มี snapshot + updated_at ไม่ตรงกับตอน snapshot — โหลดรายการล่าสุดมาเทียบครั้งเดียวต่อ id
  // (ยกเว้น id ที่เพิ่ง fail ไปแล้ว — รอ retryChangedDetail สั่งใหม่ ไม่ retry วนซ้ำเอง)
  useEffect(() => {
    selectedSets.forEach((entry) => {
      if (entry.kind !== 'live' || !entry.snapshot) return;
      if (!hasProductSetChanged(entry.liveSet.updatedAt, entry.snapshot.set_updated_at)) return;
      if (
        changedDetails[entry.id] ||
        changedErrors[entry.id] ||
        fetchingRef.current.has(entry.id)
      ) {
        return;
      }
      fetchingRef.current.add(entry.id);
      void getPromotionProductSet(entry.id)
        .then((detail) => {
          setChangedDetails((prev) => ({ ...prev, [entry.id]: detail }));
        })
        .catch(() => {
          setChangedErrors((prev) => ({ ...prev, [entry.id]: true }));
        })
        .finally(() => {
          fetchingRef.current.delete(entry.id);
        });
    });
  }, [selectedSets, changedDetails, changedErrors]);

  const retryChangedDetail = (id: string) => {
    setChangedErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // เอา id ออกจาก selection เฉยๆ — การตัด id ออกจาก refreshIds เมื่อไม่มี include/exclude อ้างถึงอีกแล้ว
  // เป็นหน้าที่ของ caller (CouponRedemptionRuleFields) เพราะ picker ตัวเดียวไม่รู้ว่าอีกฝั่งยังเลือกอยู่ไหม
  const toggle = (id: string) => {
    const isSelected = selectedIds.includes(id);
    onChange(
      isSelected ? selectedIds.filter((existing) => existing !== id) : [...selectedIds, id],
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-gray-100 bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-gray-800">{title}</div>
        <Link
          to={appendReturnTo('/promotion-product-sets', location.pathname)}
          onClick={stashDraftOnClick}
          target={manageLinkTarget}
          rel={manageLinkTarget ? 'noopener noreferrer' : undefined}
          className="text-xs text-blue-600 hover:underline"
        >
          จัดการ Promotion Product Set
        </Link>
      </div>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}

      {selectedSets.length > 0 && (
        <div className="space-y-2">
          {selectedSets.map((entry) => (
            <SelectedSetCard
              key={entry.id}
              entry={entry}
              disabled={disabled}
              loading={loading}
              loadError={loadError}
              latestDetail={changedDetails[entry.id]}
              changedError={!!changedErrors[entry.id]}
              onRetryChanged={() => retryChangedDetail(entry.id)}
              radioName={`refresh-product-set-${pickerId}-${entry.id}`}
              refreshIds={refreshIds}
              onRefreshChange={onRefreshChange}
              onRemove={() => toggle(entry.id)}
            />
          ))}
        </div>
      )}

      {loadError && (
        <p className="text-xs text-red-600">
          โหลดรายการ Promotion Product Set ไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง
        </p>
      )}

      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((prev) => !prev)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {open ? 'ซ่อนรายการ' : '+ เลือก Promotion Product Set'}
        </button>

        {open && (
          <div className="mt-2 space-y-2 rounded-lg border border-gray-100 p-2">
            <Input
              label="ค้นหา Promotion Product Set"
              aria-label={`ค้นหา${title}`}
              value={search}
              disabled={disabled}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหาชื่อชุดสินค้า..."
            />
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-gray-400">กำลังโหลด...</p>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-gray-400">ไม่พบ Promotion Product Set</p>
              ) : (
                filtered.map((set) => {
                  const isSelected = selectedIds.includes(set.id);
                  const isLocked = lockedIds.includes(set.id);
                  return (
                    <label
                      key={set.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        disabled={disabled || isLocked || (!set.isActive && !isSelected)}
                        checked={isSelected || isLocked}
                        onChange={() => toggle(set.id)}
                      />
                      <span>{set.name}</span>
                      <span className="text-xs text-gray-400">{set.itemCount} รายการ</span>
                      {isLocked && <span className="text-[10px] text-gray-400">เลือกไว้แล้ว</span>}
                      {!set.isActive && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                          ปิดใช้งาน
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PromotionProductSetPicker;

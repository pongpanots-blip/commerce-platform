import {
  formatBangkokDateTime,
  resolvePromotionSkus,
  type PromotionMechanicProductSet,
  type PromotionProductItem,
} from '@josh/shared-api';
import React, { useEffect, useState } from 'react';
import PromotionProductSetPicker from '../coupon/PromotionProductSetPicker';

/** A legacy mechanic's own SKU (name from GET :id). */
export type MechanicSku = { sku: string; name: string | null };

// The coupon picker's snapshot chips are fed by coupon-shaped snapshots (SKU ids + set_updated_at)
// and diff against the live set in the browser. A mechanic's diff comes from the backend
// (`latest`), so this wrapper draws the chips of already-saved sets itself. The picker gets only
// the sets being newly added as `selectedIds` (it draws those cards correctly: "จะบันทึกรายการเมื่อ
// กดบันทึก"); the saved sets that are kept go in as `lockedIds`, so they show checked in its
// dropdown without a second card.
const NO_SNAPSHOTS = {};
const NO_IDS: string[] = [];
const noop = () => undefined;

type SkuRow = { sku: string; name?: string | null; label?: string };

function SkuRows({ title, rows }: { title: string; rows: SkuRow[] }) {
  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-white p-2">
      <p className="mb-1 text-[11px] text-gray-400">{title}</p>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {rows.map((row) => (
          <div key={row.sku} className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">{row.sku}</span>
            <span className="truncate text-gray-700">{row.name ?? ''}</span>
            {row.label && (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                {row.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type Resolved = { items: PromotionProductItem[]; inactive: string[] };

/** The SKUs in one set's snapshot. Names / "ปิดขาย" / "ไม่พบ" come from resolving the SKUs (as the coupon chip does). */
function SetItemsView({ skus }: { skus: string[] }) {
  const [state, setState] = useState<Resolved | 'loading' | 'error'>(skus.length ? 'loading' : { items: [], inactive: [] });
  const skuKey = skus.join('|');

  useEffect(() => {
    if (!skuKey) return;
    let cancelled = false;
    resolvePromotionSkus(skuKey.split('|'))
      .then((result) => !cancelled && setState(result))
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [skuKey]);

  const title = `SKU ในชุดนี้ (${skus.length.toLocaleString('th-TH')} รายการ)`;
  if (state === 'loading') return <p className="mt-2 text-xs text-gray-400">กำลังโหลดรายการ...</p>;
  if (state === 'error') {
    return (
      <>
        <SkuRows title={title} rows={skus.map((sku) => ({ sku }))} />
        <p className="mt-1 text-xs text-red-600">โหลดชื่อสินค้าไม่สำเร็จ</p>
      </>
    );
  }
  const byName = new Map(state.items.map((item) => [item.sku, item.name]));
  return (
    <SkuRows
      title={title}
      rows={skus.map((sku) => ({
        sku,
        name: byName.get(sku),
        label: byName.has(sku) ? undefined : state.inactive.includes(sku) ? 'ปิดขาย' : 'ไม่พบ',
      }))}
    />
  );
}

function ChangedNotice({
  latest,
  snapshottedAt,
  useLatest,
  onUseLatestChange,
}: {
  latest: NonNullable<PromotionMechanicProductSet['latest']>;
  snapshottedAt: string;
  useLatest: boolean;
  onUseLatestChange: (next: boolean) => void;
}) {
  const radioName = React.useId();
  const { added_skus: added, removed_skus: removed } = latest;
  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
      <p className="font-medium">ชุดนี้ถูกแก้ไขหลังบันทึกโปร</p>
      {added.length > 0 && <p>+ เพิ่ม: {added.join(', ')}</p>}
      {removed.length > 0 && <p>− ลบ: {removed.join(', ')}</p>}
      <div className="mt-1.5 flex flex-col gap-1">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={radioName}
            checked={!useLatest}
            onChange={() => onUseLatestChange(false)}
          />
          <span>ใช้รายการเดิม (บันทึกเมื่อ {formatBangkokDateTime(snapshottedAt, 'th')})</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={radioName}
            checked={useLatest}
            onChange={() => onUseLatestChange(true)}
          />
          <span>ใช้รายการล่าสุด</span>
        </label>
      </div>
    </div>
  );
}

function SavedSetChip({
  set,
  useLatest,
  onUseLatestChange,
  onRemove,
}: {
  set: PromotionMechanicProductSet;
  useLatest: boolean;
  onUseLatestChange: (next: boolean) => void;
  onRemove: () => void;
}) {
  const [viewOpen, setViewOpen] = useState(false);
  const itemsId = React.useId();
  return (
    <div
      className={`rounded-lg border p-2.5 text-xs ${
        set.set_inactive ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-gray-800">{set.name}</span>
          <span className="ml-1.5 text-gray-400">({set.item_count} รายการ)</span>
        </div>
        <button
          type="button"
          aria-label={`นำ ${set.name} ออก`}
          onClick={onRemove}
          className="shrink-0 text-gray-400 hover:text-red-500"
        >
          ×
        </button>
      </div>
      <p className="mt-1 text-gray-500">
        บันทึกรายการเมื่อ {formatBangkokDateTime(set.snapshotted_at, 'th')}
      </p>
      {set.set_deleted && (
        <p className="mt-1 text-rose-600">ชุดต้นทางถูกลบแล้ว — ใช้รายการที่บันทึกไว้</p>
      )}
      {set.set_inactive && (
        <p className="mt-1 text-amber-700">ชุดต้นทางปิดใช้งาน — โปรยังใช้รายการที่บันทึกไว้</p>
      )}
      <button
        type="button"
        aria-expanded={viewOpen}
        aria-controls={itemsId}
        onClick={() => setViewOpen((prev) => !prev)}
        className="mt-1 text-blue-600 underline hover:text-blue-700"
      >
        {viewOpen ? 'ซ่อนรายการ' : 'ดูรายการ'}
      </button>
      <div id={itemsId}>{viewOpen && <SetItemsView skus={set.items.map((item) => item.sku)} />}</div>
      {set.latest && !set.set_deleted && (
        <ChangedNotice
          latest={set.latest}
          snapshottedAt={set.snapshotted_at}
          useLatest={useLatest}
          onUseLatestChange={onUseLatestChange}
        />
      )}
    </div>
  );
}

type Props = {
  selectedIds: string[];
  onChange: (next: string[]) => void;
  /** Sets the mechanic already snapshotted (GET :id/product-sets). Empty on create and for a legacy mechanic. */
  savedSets: PromotionMechanicProductSet[];
  /** Legacy: hand-typed SKUs and no snapshots — picking a set converts it. */
  legacy?: boolean;
  /** A legacy mechanic's own SKUs, shown read-only. */
  legacySkus: MechanicSku[];
  refreshIds: string[];
  onRefreshChange: (next: string[]) => void;
  error?: string;
  errorId?: string;
};

export default function PromotionMechanicProductSets({
  selectedIds,
  onChange,
  savedSets,
  legacy,
  legacySkus,
  refreshIds,
  onRefreshChange,
  error,
  errorId,
}: Props) {
  const savedIds = new Set(savedSets.map((set) => set.id));
  const keptSavedIds = selectedIds.filter((id) => savedIds.has(id));
  const newIds = selectedIds.filter((id) => !savedIds.has(id));

  // The picker returns the new ids (plus a removed saved set ticked again); kept saved sets are
  // locked in its list, so they can't come back through it — remove them with × on their chip.
  const handlePick = (next: string[]) => onChange([...keptSavedIds, ...next]);

  const removeSaved = (id: string) => {
    onChange(selectedIds.filter((existing) => existing !== id));
    onRefreshChange(refreshIds.filter((existing) => existing !== id));
  };

  const setUseLatest = (id: string, next: boolean) =>
    onRefreshChange(
      next
        ? refreshIds.includes(id)
          ? refreshIds
          : [...refreshIds, id]
        : refreshIds.filter((existing) => existing !== id),
    );

  return (
    <div className="space-y-2">
      {legacy && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-medium">โปรนี้สร้างแบบเดิม — เลือก Product set เพื่อแปลง</p>
          <p className="mt-1">
            ยังใช้งานตามเดิมได้ แก้ชื่อ วันที่ สถานะ และ Campaign ได้โดยไม่ต้องเลือก Product set
            แต่ถ้าเลือก Product set ตอนบันทึก SKU และส่วนลดเดิมทั้งหมดจะถูกแทนที่ด้วยชุดที่เลือก
          </p>
          {legacySkus.length > 0 && (
            <SkuRows
              title={`SKU ของโปรนี้ (${legacySkus.length.toLocaleString('th-TH')} รายการ)`}
              rows={legacySkus}
            />
          )}
        </div>
      )}

      {savedSets.map((set) =>
        selectedIds.includes(set.id) ? (
          <SavedSetChip
            key={set.id}
            set={set}
            useLatest={refreshIds.includes(set.id)}
            onUseLatestChange={(next) => setUseLatest(set.id, next)}
            onRemove={() => removeSaved(set.id)}
          />
        ) : (
          // Restorable here because the picker will not let a deactivated set be ticked again.
          <div
            key={set.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 p-2.5 text-xs text-gray-500"
          >
            <span>จะนำ “{set.name}” ออกเมื่อกดบันทึก</span>
            <button
              type="button"
              onClick={() => onChange([...selectedIds, set.id])}
              className="shrink-0 text-blue-600 underline hover:text-blue-700"
            >
              ยกเลิกการลบ
            </button>
          </div>
        ),
      )}

      <PromotionProductSetPicker
        title="เลือก Product set"
        hint="ทุก SKU ในชุดที่เลือกได้ส่วนลดเดียวกัน — ระบบคัดลอกรายการ SKU ไว้ตอนกดบันทึก"
        selectedIds={newIds}
        lockedIds={keptSavedIds}
        onChange={handlePick}
        snapshots={NO_SNAPSHOTS}
        refreshIds={NO_IDS}
        onRefreshChange={noop}
        // no draft stash for a mechanic form: leaving the page would lose it
        manageLinkTarget="_blank"
      />
      {error && (
        <p id={errorId} className="text-sm text-alert">
          {error}
        </p>
      )}
    </div>
  );
}

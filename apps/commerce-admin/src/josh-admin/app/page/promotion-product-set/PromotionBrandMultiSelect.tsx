import { getBrands } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useMemo, useState } from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import { useCloseOnOutsideClick } from './useCloseOnOutsideClick';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type BrandRow = {
  id: string;
  brand_code: string;
  brand_name_th: string | null;
  brand_name_en: string | null;
};

/** brand_name_en (brand_code) → falls back to brand_name_th (brand_code) → falls back to brand_code alone */
function labelOf(brand: BrandRow): string {
  const name = brand.brand_name_en || brand.brand_name_th;
  return name ? `${name} (${brand.brand_code})` : brand.brand_code;
}

type Props = {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

/** เลือกแบรนด์แบบหลายรายการ (dropdown + ค้นหา + checkbox), ทรงเดียวกับ PromotionCategoryMultiSelect */
export function PromotionBrandMultiSelect({ selectedIds, onChange }: Props) {
  __useUiLocale();
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useCloseOnOutsideClick<HTMLDivElement>(open, setOpen);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response: any = await getBrands();
        setBrands(response?.data?.data ?? []);
        setLoadError(false);
      } catch {
        setBrands([]);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(() => new Map(brands.map((brand) => [brand.id, brand])), [brands]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return brands;
    return brands.filter((brand) =>
      [brand.brand_name_en, brand.brand_name_th, brand.brand_code]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(needle)),
    );
  }, [brands, search]);

  const toggle = (id: string) => {
    onChange(selected.has(id) ? selectedIds.filter((existing) => existing !== id) : [...selectedIds, id]);
  };

  const removeChip = (id: string) => {
    onChange(selectedIds.filter((existing) => existing !== id));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-lg border-2 border-primary-border bg-white px-3 py-2 text-sm text-ink hover:border-primary"
      >
        <span>{__uiText("เลือกแบรนด์ (")}{selectedIds.length})</span>
        <span className="text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {loadError && (
        <p className="mt-1 text-xs text-red-600">
          {__uiText("โหลดรายการแบรนด์ไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง")}</p>
      )}

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2">
            <Input
              icon={<AiOutlineSearch size={18} />}
              placeholder={__uiText("ค้นหาแบรนด์...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {loading ? (
              <p className="py-4 text-center text-xs text-gray-400">{__uiText("กำลังโหลด...")}</p>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">{__uiText("ไม่พบแบรนด์")}</p>
            ) : (
              <ul>
                {filtered.map((brand) => (
                  <li key={brand.id}>
                    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-800">
                      <input
                        type="checkbox"
                        checked={selected.has(brand.id)}
                        onChange={() => toggle(brand.id)}
                      />
                      <span>{labelOf(brand)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-gray-100 p-2 text-right">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10"
            >
              {__uiText("เสร็จสิ้น")}</button>
          </div>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedIds.map((id) => {
            const brand = byId.get(id);
            // ยังโหลดอยู่/โหลดพัง — ไม่รู้จริงๆ ว่ามีแบรนด์นี้อยู่ไหม โชว์ "กำลังโหลด…" แทน raw UUID
            const label = brand ? labelOf(brand) : loading || loadError ? 'กำลังโหลด…' : id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
              >
                <span>{label}</span>
                <button
                  type="button"
                  onClick={() => removeChip(id)}
                  className="ml-1 text-gray-400 hover:text-red-500"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PromotionBrandMultiSelect;

import { Input } from '@josh/shared-ui-web';
import React, { useMemo, useState } from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import { useCloseOnOutsideClick } from './useCloseOnOutsideClick';
import { levelLabel, type CategoryRow } from '../category/category-form';
import { childrenOf, level1Rows, searchCategories } from '../category/category-tree.helpers';
import {
  categoryParentMap,
  isCoveredByAncestor,
  toggleCategoryId,
} from './promotion-product-set.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
function labelOf(row: CategoryRow): string {
  const name = row.category_name_en || row.category_id_uuid;
  return row.cat_code ? `${name} (${row.cat_code})` : name;
}

type Props = {
  rows: CategoryRow[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

function CategoryNode({
  row,
  rows,
  selected,
  parents,
  onToggle,
  depth,
}: {
  row: CategoryRow;
  rows: CategoryRow[];
  selected: Set<string>;
  parents: Map<string, string | null>;
  onToggle: (id: string) => void;
  depth: number;
}) {
  const id = row.category_id_uuid;
  const kids = childrenOf(rows, id);
  const covered = isCoveredByAncestor(id, selected, parents);
  const checked = selected.has(id) || covered;

  return (
    <li>
      <label
        className="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-800"
        style={{ paddingLeft: depth * 16 }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={covered}
          onChange={() => onToggle(id)}
        />
        <span className={covered ? 'text-gray-400' : ''}>{labelOf(row)}</span>
      </label>
      {kids.length > 0 && (
        <ul>
          {kids.map((kid) => (
            <CategoryNode
              key={kid.category_id_uuid}
              row={kid}
              rows={rows}
              selected={selected}
              parents={parents}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** เลือกหมวดหมู่แบบหลายรายการ (dropdown ทับ tree) — ติ๊กแม่ครอบลูกทั้งกิ่ง, ค้นหาได้ทุกชั้น */
export function PromotionCategoryMultiSelect({ rows, selectedIds, onChange }: Props) {
  __useUiLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useCloseOnOutsideClick<HTMLDivElement>(open, setOpen);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const parents = useMemo(() => categoryParentMap(rows), [rows]);
  // เริ่มที่ Level 1 เรียงตามลำดับเดียวกับแถวหมวดบนหน้าแรก (Home category) — ลูกค้าไม่เห็น Division
  const roots = useMemo(() => level1Rows(rows).map(({ row }) => row), [rows]);
  const searchResults = useMemo(() => searchCategories(rows, search), [rows, search]);

  const handleToggle = (id: string) => {
    onChange([...toggleCategoryId(rows, selected, id, parents)]);
  };

  const removeChip = (id: string) => {
    onChange(selectedIds.filter((existing) => existing !== id));
  };

  const byId = useMemo(
    () => new Map(rows.map((row) => [row.category_id_uuid, row])),
    [rows],
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-lg border-2 border-primary-border bg-white px-3 py-2 text-sm text-ink hover:border-primary"
      >
        <span>{__uiText("เลือกหมวดหมู่ (")}{selectedIds.length})</span>
        <span className="text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2">
            <Input
              icon={<AiOutlineSearch size={18} />}
              placeholder={__uiText("ค้นหาหมวดหมู่ทุกชั้น...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {search.trim() ? (
              searchResults.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">{__uiText("ไม่พบหมวดที่ตรงกับคำค้น")}</p>
              ) : (
                <ul>
                  {searchResults.map((row) => (
                    <CategoryNode
                      key={row.category_id_uuid}
                      row={row}
                      rows={[]}
                      selected={selected}
                      parents={parents}
                      onToggle={handleToggle}
                      depth={0}
                    />
                  ))}
                </ul>
              )
            ) : roots.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">{__uiText("ไม่พบหมวดหมู่")}</p>
            ) : (
              <ul>
                {roots.map((row) => (
                  <CategoryNode
                    key={row.category_id_uuid}
                    row={row}
                    rows={rows}
                    selected={selected}
                    parents={parents}
                    onToggle={handleToggle}
                    depth={0}
                  />
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
            const row = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
              >
                <span className="min-w-0 break-all">{row ? labelOf(row) : id}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-400">
                  {levelLabel(row?.category_level ?? 0).split(' · ')[0]}
                </span>
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

export default PromotionCategoryMultiSelect;

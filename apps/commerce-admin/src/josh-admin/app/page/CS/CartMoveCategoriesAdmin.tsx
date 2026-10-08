// ui-metadata-migration: static labels and UI notices only
import {
  getCartMoveAllowedCategories,
  putCartMoveAllowedCategories,
} from '@josh/shared-api';
import { Button } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import {
  type CategoryRow,
  useCategoryRowsQuery,
} from '../category/category-form';
import { childrenOf } from '../category/category-tree.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
function parentMap(rows: CategoryRow[]): Map<string, string | null> {
  return new Map(
    rows.map((row) => [row.category_id_uuid, row.parent_id_uuid ?? null]),
  );
}

/** true เมื่อมีบรรพบุรุษอยู่ใน selected — ลูกถูกครอบโดยแม่ที่ติ๊ก */
function isCoveredByAncestor(
  id: string,
  selected: Set<string>,
  parents: Map<string, string | null>,
): boolean {
  let cursor = parents.get(id) ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (selected.has(cursor)) return true;
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return false;
}

function descendantIds(rows: CategoryRow[], rootId: string): string[] {
  const kids = childrenOf(rows, rootId);
  const out: string[] = [];
  for (const kid of kids) {
    out.push(kid.category_id_uuid);
    out.push(...descendantIds(rows, kid.category_id_uuid));
  }
  return out;
}

function toggleCategory(
  rows: CategoryRow[],
  selected: Set<string>,
  id: string,
  parents: Map<string, string | null>,
): Set<string> {
  if (isCoveredByAncestor(id, selected, parents)) return selected;
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  next.add(id);
  for (const desc of descendantIds(rows, id)) {
    next.delete(desc);
  }
  return next;
}

function labelOf(row: CategoryRow): string {
  return row.category_name_th || row.category_name_en || row.category_id_uuid;
}

function CategoryNode({
  row,
  rows,
  selected,
  parents,
  expanded,
  onToggleExpand,
  onToggle,
  depth,
}: {
  row: CategoryRow;
  rows: CategoryRow[];
  selected: Set<string>;
  parents: Map<string, string | null>;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggle: (id: string) => void;
  depth: number;
}) {
  __useUiLocale();
  const id = row.category_id_uuid;
  const kids = childrenOf(rows, id);
  const covered = isCoveredByAncestor(id, selected, parents);
  const checked = selected.has(id) || covered;
  const isOpen = expanded.has(id);

  return (
    <li>
      <div
        className="flex items-center gap-2 py-1"
        style={{ paddingLeft: depth * 16 }}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            className="w-5 text-xs text-gray-500"
            onClick={() => onToggleExpand(id)}
            aria-label={isOpen ? __uiText("Collapse") : __uiText("Expand")}
          >
            {isOpen ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={checked}
            disabled={covered}
            onChange={() => onToggle(id)}
          />
          <span className={covered ? 'text-gray-400' : ''}>
            {labelOf(row)}
            {row.category_name_en && row.category_name_th ? (
              <span className="ml-1 text-xs text-gray-400">
                ({row.category_name_en})
              </span>
            ) : null}
          </span>
        </label>
      </div>
      {kids.length > 0 && isOpen ? (
        <ul>
          {kids.map((kid) => (
            <CategoryNode
              key={kid.category_id_uuid}
              row={kid}
              rows={rows}
              selected={selected}
              parents={parents}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function CartMoveCategoriesAdmin() {
  __useUiLocale();
  const { rows, isLoading: loadingTree } = useCategoryRowsQuery();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingAllowlist, setLoadingAllowlist] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const parents = useMemo(() => parentMap(rows), [rows]);
  const roots = useMemo(() => childrenOf(rows, null), [rows]);

  useEffect(() => {
    void getCartMoveAllowedCategories()
      .then((res) => {
        setSelected(new Set(res.categoryIds ?? []));
      })
      .catch((err: { response?: { data?: { message?: string } }; message?: string }) => {
        setError(
          err?.response?.data?.message ?? err.message ?? __uiMessage("โหลด allowlist ไม่สำเร็จ"),
        );
      })
      .finally(() => setLoadingAllowlist(false));
  }, []);

  // เปิด Division ชั้นบนสุดเป็นค่าเริ่มต้นให้เห็น L1
  useEffect(() => {
    if (roots.length === 0) return;
    setExpanded((prev) => {
      if (prev.size > 0) return prev;
      return new Set(roots.map((r) => r.category_id_uuid));
    });
  }, [roots]);

  const onToggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onToggle = useCallback(
    (id: string) => {
      setSelected((prev) => toggleCategory(rows, prev, id, parents));
      setSavedMsg('');
    },
    [rows, parents],
  );

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      const res = await putCartMoveAllowedCategories([...selected]);
      setSelected(new Set(res.categoryIds ?? []));
      setSavedMsg(`บันทึกแล้ว ${res.categoryIds.length} หมวด`);
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      setError(e?.response?.data?.message ?? e.message ?? __uiMessage("บันทึกไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  };

  const loading = loadingTree || loadingAllowlist;

  return (
    <div className="p-6">
      <AdminListHeader
        title={__uiText("Unlock Move Categories")}
        subtitle={__uiText("หมวดที่อนุญาตให้ย้ายข้าม shipment ใน Unlock Free Shipping — ติ๊กแม่ครอบทั้งต้นไม้ หรือเลือกแค่บาง subcate")}
      />

      <p className="mb-4 max-w-2xl text-sm text-gray-600">
        {__uiText("สินค้า order-taking ย้ายไม่ได้เสมอ เปลี่ยนวันส่งไม่ใช้รายการนี้ ติ๊กหมวดแม่แล้วลูกจะถูกครอบอัตโนมัติ (checkbox ลูกเป็นสีเทา) ถ้าต้องการแค่บาง subcate ให้ติ๊กเฉพาะลูกโดยไม่ติ๊กแม่")}</p>

      {loading ? (
        <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
            </Button>
            <span className="text-sm text-gray-500">
              {__uiText("เลือกแล้ว ")}{selected.size} {__uiText(" หมวด")}</span>
            {savedMsg ? (
              <span className="text-sm text-green-700">{savedMsg}</span>
            ) : null}
          </div>

          {error ? <p className="text-sm text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p> : null}

          <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200 bg-white p-3">
            {roots.length === 0 ? (
              <p className="text-sm text-gray-500">{__uiText("ไม่พบหมวดหมู่")}</p>
            ) : (
              <ul>
                {roots.map((row) => (
                  <CategoryNode
                    key={row.category_id_uuid}
                    row={row}
                    rows={rows}
                    selected={selected}
                    parents={parents}
                    expanded={expanded}
                    onToggleExpand={onToggleExpand}
                    onToggle={onToggle}
                    depth={0}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

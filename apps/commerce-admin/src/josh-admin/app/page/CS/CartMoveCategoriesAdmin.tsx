// ui-metadata-migration: static labels and UI notices only
import {
  getCartMoveAllowedCategories,
  putCartMoveAllowedCategories,
} from '@josh/shared-api';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import {
  type CategoryRow,
  useCategoryRowsQuery,
} from '../category/category-form';
import { childrenOf } from '../category/category-tree.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, Button, Empty, Icon, Loading, Panel, PanelHead, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
            className="flex w-5 items-center justify-center text-on-surface-variant"
            onClick={() => onToggleExpand(id)}
            aria-label={isOpen ? __uiText("ย่อหมวดย่อย") : __uiText("ขยายหมวดย่อย")}
          >
            <Icon name={isOpen ? 'expand_more' : 'chevron_right'} size={18} />
          </button>
        ) : (
          <span className="w-5" />
        )}
        <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-on-surface">
          <input
            type="checkbox"
            checked={checked}
            disabled={covered}
            onChange={() => onToggle(id)}
          />
          <span className={covered ? 'text-outline' : ''}>
            {labelOf(row)}
            {row.category_name_en && row.category_name_th ? (
              <span className="ml-1 text-xs text-outline">
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
          err?.response?.data?.message ?? err.message ?? __uiMessage("โหลดรายการหมวดไม่สำเร็จ"),
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
      setSavedMsg(__uiText("บันทึกแล้ว {0} หมวด", { 0: res.categoryIds.length }));
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
    <div className="cp-management-page grid w-full gap-5">
      <AdminListHeader
        title={__uiText("หมวดที่ย้ายของในตะกร้าได้")}
        subtitle={__uiText("เลือกหมวดสินค้าที่ลูกค้าย้ายไปส่งรอบอื่นได้ เพื่อให้ยอดถึงเกณฑ์ส่งฟรี")}
      />

      <p className="max-w-3xl text-sm text-on-surface-variant">
        {__uiText("สินค้าสั่งล่วงหน้าย้ายไม่ได้เสมอ และการเปลี่ยนวันส่งไม่ใช้รายการนี้ ติ๊กหมวดแม่แล้วหมวดย่อยทั้งหมดจะถูกเลือกด้วย (ช่องเป็นสีเทา) ถ้าต้องการแค่บางหมวดย่อย ให้ติ๊กเฉพาะหมวดย่อยโดยไม่ติ๊กหมวดแม่")}</p>

      {error ? <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert> : null}

      <Panel className="overflow-hidden">
        <PanelHead
          icon="category"
          title={__uiText("หมวดสินค้า")}
          sub={!loading && <>{__uiText("เลือกแล้ว ")}{selected.size} {__uiText(" หมวด")}</>}
        />
        {loading ? (
          <Loading variant="form" />
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto p-3">
              {roots.length === 0 ? (
                <Empty icon="category">{__uiText("ไม่พบหมวดหมู่")}</Empty>
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
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-secondary-container px-4 py-3">
              {savedMsg ? (
                <span role="status" className="text-sm text-ok">{savedMsg}</span>
              ) : null}
              <Button
                variant="primary"
                icon="check"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
              </Button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

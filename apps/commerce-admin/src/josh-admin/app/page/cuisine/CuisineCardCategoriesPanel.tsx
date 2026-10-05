import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import {
  addCuisineCardCategoriesAdmin,
  getCategoriesPaginated,
  listCuisineCardCategoriesAdmin,
  removeCuisineCardCategoriesAdmin,
  type CuisineCardCategoryAdmin,
  type CuisineCategoryMutationResult,
  type CuisineCategoryOrderItem,
} from '@josh/shared-api';
import { useCallback, useEffect, useState } from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import { MdDragIndicator, MdOutlineAddCircle, MdOutlineDelete } from 'react-icons/md';
import { moveItem } from '../category/category-tree.helpers';

type CategoryOption = {
  category_id: string;
  category_name_th: string | null;
  category_name_en: string;
  category_level: number;
  category_path: string | null;
};

function labelOf(row: CategoryOption | CuisineCardCategoryAdmin): string {
  return row.category_name_th || row.category_name_en || row.category_id;
}

/** ตัด Division ออกจาก path ให้เหลือส่วนที่คนอ่านแล้วแยกหมวดได้จริง */
function shortPath(path: string | null): string {
  if (!path) return '';
  const parts = path.split('>').map((p) => p.trim());
  return parts.length > 1 ? parts.slice(1).join(' › ') : path;
}

type Props = {
  cardId?: string | null;
  cuisineId: string | null;
  onTaxonomyMaybeChanged?: (cuisineId?: string) => void;
  /** Fired after list load / mutate so parent can refresh taxonomy summary. */
  onBindingsChanged?: () => void;
  draftCategories?: CuisineCardCategoryAdmin[];
  onDraftCategoriesChange?: (rows: CuisineCardCategoryAdmin[]) => void;
  /**
   * ลำดับที่แก้ค้างไว้ — parent เอาไปยิง reorder ตอนกด "บันทึก" ของทั้งหน้า
   * (`null` = ไม่มีอะไรค้าง)
   */
  onPendingOrderChange?: (items: CuisineCategoryOrderItem[] | null) => void;
};

export function CuisineCardCategoriesPanel({
  cardId,
  cuisineId,
  onTaxonomyMaybeChanged,
  onBindingsChanged,
  draftCategories,
  onDraftCategoriesChange,
  onPendingOrderChange,
}: Props) {
  const isDraft = !cardId;
  const [linked, setLinked] = useState<CuisineCardCategoryAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResult, setSearchResult] = useState<CategoryOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [orderDirty, setOrderDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = isDraft ? (draftCategories ?? []) : linked;

  const setDraft = (next: CuisineCardCategoryAdmin[]) => {
    onDraftCategoriesChange?.(next);
  };

  /** แถวที่แสดง = ลำดับปัจจุบันบนจอ → ส่งให้ parent เป็น sort_category_order 1..n */
  const publishOrder = useCallback(
    (rows: CuisineCardCategoryAdmin[]) => {
      onPendingOrderChange?.(
        rows.map((row, index) => ({
          category_id: row.category_id,
          sort_category_order: index + 1,
        })),
      );
    },
    [onPendingOrderChange],
  );

  const loadLinked = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    setError(null);
    try {
      // backend เรียง sort_category_order มาแล้ว — ลำดับบนจอ = ลำดับใน DB
      setLinked(await listCuisineCardCategoriesAdmin(cardId));
      setOrderDirty(false);
      onPendingOrderChange?.(null);
    } catch {
      setError('โหลดหมวดหมู่ที่ผูกไม่สำเร็จ');
      setLinked([]);
    } finally {
      setLoading(false);
    }
  }, [cardId, onPendingOrderChange]);

  useEffect(() => {
    void loadLinked();
  }, [loadLinked]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const response: unknown = await getCategoriesPaginated(
            1,
            30,
            searchTerm.trim(),
            3,
            undefined,
            true,
          );
          const body = (response as { data?: unknown })?.data ?? response;
          const payload = (body as { data?: unknown })?.data ?? body;
          const rows = Array.isArray((payload as { data?: unknown })?.data)
            ? ((payload as { data: unknown[] }).data)
            : Array.isArray(payload)
              ? payload
              : [];
          setSearchResult(
            (rows as Record<string, unknown>[])
              .map((row) => ({
                category_id: String(row.category_id_uuid ?? row.id ?? ''),
                category_name_th: (row.category_name_th as string | null) ?? null,
                category_name_en: String(row.category_name_en ?? ''),
                category_level: Number(row.category_level ?? 3),
                category_path: (row.category_path as string | null) ?? null,
              }))
              .filter((r) => r.category_id && r.category_level === 3),
          );
        } catch {
          setSearchResult([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const isSelected = (categoryId: string) =>
    categories.some((c) => c.category_id === categoryId);

  const notifyTaxonomy = (result: CuisineCategoryMutationResult) => {
    if (result.cuisine_id && result.cuisine_id !== cuisineId) {
      onTaxonomyMaybeChanged?.(result.cuisine_id);
    }
    onBindingsChanged?.();
  };

  const handleAdd = async (row: CategoryOption) => {
    if (!row.category_id || isSelected(row.category_id)) return;
    if (isDraft) {
      setDraft([
        ...categories,
        {
          category_id: row.category_id,
          category_name_th: row.category_name_th,
          category_name_en: row.category_name_en,
          category_level: 3,
          category_path: row.category_path,
          sort_category_order: categories.length + 1,
        },
      ]);
      return;
    }
    setBusyId(row.category_id);
    setError(null);
    try {
      const result = await addCuisineCardCategoriesAdmin(cardId, [row.category_id]);
      if (result.invalid.includes(row.category_id)) {
        setError('หมวดนี้ไม่ใช่ Level 3 หรือไม่พบในระบบ');
      }
      notifyTaxonomy(result);
      await loadLinked();
    } catch {
      setError('ผูกหมวดหมู่ไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (categoryId: string) => {
    if (isDraft) {
      setDraft(categories.filter((c) => c.category_id !== categoryId));
      return;
    }
    setBusyId(categoryId);
    setError(null);
    try {
      await removeCuisineCardCategoriesAdmin(cardId, [categoryId]);
      await loadLinked();
      onBindingsChanged?.();
    } catch {
      setError('ลบการผูกหมวดหมู่ไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  /** ย้ายแถวแล้วบอก parent ว่ามีลำดับค้างรอบันทึก (draft เก็บลำดับในตัว array เอง) */
  const applyMove = (from: number, to: number) => {
    if (from === to || to < 0 || to >= categories.length) return;
    const next = moveItem(categories, from, to);
    if (isDraft) {
      setDraft(next.map((row, i) => ({ ...row, sort_category_order: i + 1 })));
      return;
    }
    setLinked(next);
    setOrderDirty(true);
    publishOrder(next);
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    applyMove(result.source.index, result.destination.index);
  };

  /** พิมพ์เลขลำดับตรง ๆ — เร็วกว่าการลากเมื่อรายการยาว */
  const handleJumpTo = (from: number, rawValue: string) => {
    const target = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(target)) return;
    applyMove(from, Math.min(Math.max(target, 1), categories.length) - 1);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-ink">
          หมวดหมู่ที่ผูกกับ Taxonomy ({categories.length})
        </p>
        <p className="text-xs text-ink-muted">
          {isDraft
            ? 'เลือกหมวดไว้ก่อน — จะผูกหลังกดบันทึกสร้างการ์ด ลำดับบนจอคือลำดับที่จะบันทึก'
            : 'ลากหรือพิมพ์เลขเพื่อจัดลำดับ แล้วกดบันทึกด้านล่างสุดของหน้า — ลำดับนี้คือ sort_category_order'}
        </p>
      </div>

      {error && <p className="text-sm text-alert">{error}</p>}

      <div className="space-y-3 rounded-xl border border-primary-border bg-white p-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-ink">
          <AiOutlineSearch /> ค้นหาหมวด Level 3
        </p>
        <input
          type="text"
          className="w-full rounded-lg border border-primary-border bg-gray-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="ค้นหาชื่อหมวด..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searching && <p className="text-xs text-ink-muted">กำลังค้นหา...</p>}
        <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
          {searchResult.map((row) => (
            <div
              key={row.category_id}
              className="flex items-center justify-between rounded-lg border border-dashed border-primary-border p-2 text-xs"
            >
              <div className="min-w-0 pr-2">
                <p className="truncate font-medium text-ink">{labelOf(row)}</p>
                <p className="truncate text-ink-muted">
                  {shortPath(row.category_path) || row.category_name_en || row.category_id}
                </p>
              </div>
              <button
                type="button"
                disabled={isSelected(row.category_id) || busyId === row.category_id}
                onClick={() => void handleAdd(row)}
                className="shrink-0 p-1 text-primary disabled:opacity-30"
                aria-label={`เพิ่มหมวด ${labelOf(row)}`}
              >
                <MdOutlineAddCircle size={22} />
              </button>
            </div>
          ))}
          {!searching && searchResult.length === 0 && (
            <p className="col-span-full py-3 text-center text-xs text-ink-muted">
              {searchTerm.trim()
                ? 'ไม่พบหมวด Level 3 — ลองคำค้นอื่น'
                : 'พิมพ์ชื่อหมวดเพื่อค้นหา'}
            </p>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-primary-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary-border px-4 py-3">
          <p className="text-xs font-semibold text-ink">
            ลำดับหมวดบนหน้า Cuisine ({categories.length})
          </p>
          {orderDirty && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              แก้ลำดับแล้ว — กดบันทึกเพื่อยืนยัน
            </span>
          )}
        </div>

        {loading ? (
          <p className="px-4 py-6 text-xs text-ink-muted">กำลังโหลด...</p>
        ) : categories.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-muted">ยังไม่มีหมวด — ค้นหาแล้วกดเพิ่ม</p>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-primary-border bg-primary-soft/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <span className="w-5 shrink-0" />
              <span className="w-14 shrink-0 text-center">ลำดับ</span>
              <span className="min-w-0 flex-1">หมวดหมู่</span>
              <span className="w-16 shrink-0 text-center">Level</span>
              <span className="w-8 shrink-0" />
            </div>
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="cuisine-card-categories">
                {(dropProvided) => (
                  <ul
                    {...dropProvided.droppableProps}
                    ref={dropProvided.innerRef}
                    className="max-h-[28rem] divide-y divide-line overflow-y-auto"
                  >
                    {categories.map((item, index) => (
                      <Draggable
                        key={item.category_id}
                        draggableId={item.category_id}
                        index={index}
                      >
                        {(dragProvided, snapshot) => (
                          <li
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={`flex items-center gap-3 bg-white px-4 py-2 ${
                              snapshot.isDragging ? 'rounded-lg shadow-level-1' : ''
                            }`}
                          >
                            <span
                              {...dragProvided.dragHandleProps}
                              className="shrink-0 cursor-grab text-ink-muted hover:text-ink-secondary"
                              title="ลากเพื่อจัดลำดับ"
                            >
                              <MdDragIndicator size={18} />
                            </span>

                            <input
                              type="number"
                              min={1}
                              max={categories.length}
                              value={index + 1}
                              onChange={(e) => handleJumpTo(index, e.target.value)}
                              aria-label={`ลำดับของ ${labelOf(item)}`}
                              className="w-14 shrink-0 rounded-md border border-primary-border bg-gray-50 px-1 py-1 text-center text-xs outline-none focus:ring-2 focus:ring-primary/20"
                            />

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-ink">
                                {labelOf(item)}
                              </p>
                              <p className="truncate text-xs text-ink-muted">
                                {shortPath(item.category_path) || item.category_name_en}
                              </p>
                            </div>

                            <span
                              className={`w-16 shrink-0 text-center text-[11px] font-medium ${
                                item.category_level === 3
                                  ? 'text-ink-muted'
                                  : 'text-amber-700'
                              }`}
                              title={
                                item.category_level === 3
                                  ? 'Sub Category Level 3'
                                  : 'หมวดระดับบน — ผูกไว้เพราะไม่มีหมวดย่อย'
                              }
                            >
                              L{item.category_level}
                            </span>

                            <button
                              type="button"
                              disabled={busyId === item.category_id}
                              onClick={() => void handleRemove(item.category_id)}
                              className="w-8 shrink-0 p-1 text-alert disabled:opacity-40"
                              aria-label={`ลบหมวด ${labelOf(item)}`}
                            >
                              <MdOutlineDelete size={18} />
                            </button>
                          </li>
                        )}
                      </Draggable>
                    ))}
                    {dropProvided.placeholder}
                  </ul>
                )}
              </Droppable>
            </DragDropContext>
          </>
        )}
      </div>
    </div>
  );
}

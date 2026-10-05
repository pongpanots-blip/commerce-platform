import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import {
  reorderLevel1ProductCategories,
  reorderProductCategoryChildren,
  updateCategory,
} from '@josh/shared-api';
import { Button, Input } from '@josh/shared-ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AiOutlineEdit, AiOutlineSearch } from 'react-icons/ai';
import { HiOutlineExternalLink } from 'react-icons/hi';
import { MdDragIndicator } from 'react-icons/md';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';
import { CopyIdButton } from '../../components/CopyIdButton';
import {
  CATEGORY_ROWS_QUERY_KEY,
  CategoryRow,
  levelLabel,
  useCategoryRowsQuery,
} from './category-form';
import {
  ancestorTrail,
  childrenOf,
  level1Rows,
  moveItem,
  orderChanged,
  searchCategories,
} from './category-tree.helpers';

const API_BASE = 'http://localhost:3000';

/** `home` = หมวด Level 1 ทั้งชั้น (สิ่งที่หน้าแรกของ shop แสดง) · `tree` = ไล่เข้าไปทีละหมวด */
type View = { kind: 'home' } | { kind: 'tree'; parentId: string | null };

function imageUrl(url?: string | null): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : `${API_BASE}${url}`;
}

function CategoryThumb({ url }: { url?: string | null }) {
  const src = imageUrl(url);
  return src ? (
    <img src={src} alt="" className="h-16 w-16 shrink-0 object-cover" />
  ) : (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center bg-primary-soft text-xl">
      📦
    </span>
  );
}

/** ปุ่มประจำแถว — คัดลอก id / แก้ไข / เปิดหน้านี้บน shop ด้วย id จริง */
function RowActions({ row }: { row: CategoryRow }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <CopyIdButton id={row.category_id_uuid} />
      <Link
        to={ADMIN_ROUTES.categoryEdit(row.category_id_uuid)}
        className="rounded-lg p-1.5 text-ink-muted hover:bg-primary-soft hover:text-primary"
        title="แก้ไขชื่อ / รูป / การแสดงผล"
      >
        <AiOutlineEdit size={18} />
      </Link>
      <a
        href={`/shop/product?categoryId=${row.category_id_uuid}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        title="ดูใน shop"
      >
        <HiOutlineExternalLink size={16} />
        ดูใน shop
      </a>
    </div>
  );
}

/**
 * `/admin/categories` — สองมุมมองบนข้อมูลชุดเดียวกัน
 *
 * **Home category (ค่าเริ่มต้น):** หมวด **Level 1 ทั้งชั้นเป็นลิสต์เดียว** เพราะแถวไอคอนหน้าแรก
 * ของ shop แสดงชั้นนี้ทั้งชั้นต่อกันเป็นแถวเดียว — ลูกค้าไม่เคยเห็น Level 0 (Division) เลย
 * มีแต่ admin ที่เห็น ลากจัดลำดับได้ทั้งชั้นข้าม Division (`PUT /product-category/level1-order`
 * เขียน `sort` เป็นเลขรันสากล 1..N) แต่ละแถวบอกว่ามาจาก Division ไหน และติ๊ก
 * "แสดงบนหน้าแรก" (`show_on_homepage`) ได้ในแถวเลย
 *
 * **Drill-in:** ไล่เข้าไปทีละหมวดแล้วลากจัดลำดับ "ลูกของหมวดนั้น" ใช้กับ **Level 2 ขึ้นไป**
 * เพราะชั้นเหล่านั้น `sort` เป็นลำดับพี่น้องใต้แม่เดียวกันและเป็นเลขท้ายของ `category_code`
 * ตรงกับสิ่งที่ `PUT /product-category/:id/children-order` รับพอดี ที่ชั้น Division ปุ่มลากถูกปิด
 * และชี้กลับมาที่ Home category
 */
const CategoryList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { rows, isLoading } = useCategoryRowsQuery();
  const [view, setView] = useState<View>({ kind: 'home' });
  const [order, setOrder] = useState<CategoryRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const isHome = view.kind === 'home';
  const parentId = view.kind === 'tree' ? view.parentId : null;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: CATEGORY_ROWS_QUERY_KEY });

  const level1 = useMemo(() => level1Rows(rows), [rows]);
  const trail = useMemo(() => ancestorTrail(rows, parentId), [rows, parentId]);
  const results = useMemo(() => searchCategories(rows, search), [rows, search]);
  const byId = useMemo(
    () => new Map(rows.map((row) => [row.category_id_uuid, row])),
    [rows],
  );
  const treeOrder = useMemo(() => childrenOf(rows, parentId), [rows, parentId]);
  const serverOrder = useMemo(
    () => (isHome ? level1.map((item) => item.row) : treeOrder),
    [isHome, level1, treeOrder],
  );

  // เข้าหมวดใหม่ / โหลดข้อมูลใหม่ → เริ่มจากลำดับล่าสุดบนเซิร์ฟเวอร์เสมอ
  useEffect(() => {
    setOrder(serverOrder);
    setError('');
  }, [serverOrder]);

  const currentNode = trail[trail.length - 1];
  const dirty = orderChanged(serverOrder, order, (row) => row.category_id_uuid);
  /* Level 1 เรียงทั้งชั้นในมุมมอง Home — drill-in ของ Division จึงลากไม่ได้ (backend ก็ปฏิเสธ)
   * เหลือลากได้เฉพาะลูกของหมวด Level 1 ขึ้นไป ซึ่งเป็นลำดับพี่น้องจริง ๆ */
  const childrenAreLevel1 = !isHome && order.some((row) => row.category_level === 1);
  const canReorder =
    order.length > 1 && (isHome || (parentId !== null && !childrenAreLevel1));

  /**
   * ติ๊ก/ปลดติ๊ก "แสดงบนหน้าแรก" ในแถว — optimistic แล้วย้อนกลับถ้า API พัง
   * ponytail: ไม่ invalidate ตอนสำเร็จ เพราะจะดึงต้นไม้ 500 แถวใหม่ทุกครั้งที่ติ๊ก
   * ค่าที่แก้เป็น boolean ตัวเดียวและ backend ไม่ derive อะไรต่อจากมัน — ถ้าวันหนึ่งมันเริ่ม
   * มีผลข้างเคียง (เช่นไปแตะ sort) ให้เปลี่ยนเป็นเขียนแถวที่ API คืนมากลับเข้าแคช
   */
  const toggleHomepage = useMutation({
    mutationFn: ({ id, show }: { id: string; show: boolean }) =>
      updateCategory(id, { show_on_homepage: show }),
    onMutate: async ({ id, show }) => {
      await queryClient.cancelQueries({ queryKey: CATEGORY_ROWS_QUERY_KEY });
      const previous = queryClient.getQueryData<CategoryRow[]>(CATEGORY_ROWS_QUERY_KEY);
      queryClient.setQueryData<CategoryRow[]>(CATEGORY_ROWS_QUERY_KEY, (current) =>
        current?.map((row) =>
          row.category_id_uuid === id ? { ...row, show_on_homepage: show } : row,
        ),
      );
      setError('');
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(CATEGORY_ROWS_QUERY_KEY, context.previous);
      }
      setError('บันทึกการแสดงบนหน้าแรกไม่สำเร็จ');
    },
  });

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    setOrder((current) => moveItem(current, result.source.index, result.destination!.index));
  };

  /** Level 1 → จัดทั้งชั้น · ชั้นอื่น → จัดในกลุ่มพี่น้องของหมวดแม่ที่เปิดอยู่ */
  const handleSave = async () => {
    const orderedIds = order.map((row) => row.category_id_uuid);
    setSaving(true);
    setError('');
    try {
      if (isHome) {
        await reorderLevel1ProductCategories(orderedIds);
      } else if (parentId) {
        await reorderProductCategoryChildren(parentId, orderedIds);
      }
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'บันทึกลำดับไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const openCategory = (id: string | null) => {
    setSearch('');
    setView({ kind: 'tree', parentId: id });
  };

  const openHome = () => {
    setSearch('');
    setView({ kind: 'home' });
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
  }

  const shownOnHome = level1.filter(
    ({ row }) => row.show_on_homepage !== false,
  ).length;

  const listCaption = isHome
    ? `Level 1 ทั้งหมด ${order.length} หมวด · ติ๊กแสดงบนหน้าแรก ${shownOnHome} หมวด — ลากเรียงได้ทั้งชั้น ข้าม Division`
    : parentId === null
      ? `Division ชั้นบนสุด ${order.length} หมวด — ลำดับของ Division มาจาก seed จัดที่นี่ไม่ได้`
      : childrenAreLevel1
        ? `หมวด Level 1 ${order.length} หมวดใต้ ${currentNode?.category_name_en} — ลำดับของชั้นนี้จัดรวมทั้งชั้นที่ Home category`
        : `หมวดย่อย ${order.length} หมวด — ลากเพื่อจัดลำดับ แล้วกดบันทึก`;

  return (
    <div className="flex flex-col gap-4 p-4">
      <AdminListHeader
        title="Categories"
        subtitle="หน้าแรกของ shop แสดงหมวด Level 1 ทั้งชั้น — ลากเรียงลำดับและติ๊กเลือกว่าหมวดไหนขึ้นหน้าแรกได้ที่นี่"
        // ponytail: ซ่อนปุ่มสร้าง — หน้า /admin/categories/create ยังอยู่ ใส่ createPath กลับเมื่อจะเปิดใช้

      />

      {error && (
        <p className="rounded-lg border border-alert/30 bg-alert-soft px-4 py-2 text-sm text-alert">
          {error}
        </p>
      )}

      {/* การ์ดเนื้อหา — toolbar ค้นหาด้านบน ตามด้วยตาราง/breadcrumb ของมุมมองปัจจุบัน */}
      <div className="rounded-lg bg-white shadow-level-1">
        <div className="flex justify-end gap-3 border-b border-primary-border p-3">
          <Input
            icon={<AiOutlineSearch size={20} />}
            className="md:w-[296px]"
            placeholder="ค้นหาทุกชั้น — ชื่อ EN / TH / path / รหัส / วาง id มาเลยก็ได้"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {search.trim() ? (
          <div>
            <p className="border-b border-line px-4 py-2 text-xs text-ink-muted">
              ผลค้นหา {results.length} หมวด — ล้างคำค้นเพื่อจัดลำดับ / เปิด-ปิดแสดงบนหน้าแรก
            </p>
            {results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">ไม่พบหมวดที่ตรงกับคำค้น</p>
            ) : (
              <ul className="divide-y divide-line">
                {results.map((row) => (
                  <li key={row.category_id_uuid} className="flex h-16 items-center gap-3 px-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {row.category_name_en}
                        {row.category_name_th ? (
                          <span className="ml-2 text-ink-secondary">{row.category_name_th}</span>
                        ) : null}
                        <span className="ml-2 text-xs text-ink-muted">
                          Level {row.category_level ?? '—'}
                          {row.parent_id_uuid
                            ? ` · ใต้ ${byId.get(row.parent_id_uuid)?.category_name_en ?? '—'}`
                            : ''}
                        </span>
                      </p>
                      <p className="truncate font-mono text-xs text-ink-muted">
                        {row.category_path} · {row.category_code ?? '—'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        row.category_level === 1 ? openHome() : openCategory(row.parent_id_uuid ?? null)
                      }
                      className="shrink-0 text-xs text-primary hover:underline"
                      title="เปิดกลุ่มที่จัดลำดับหมวดนี้ได้"
                    >
                      ไปที่กลุ่มนี้
                    </button>
                    <RowActions row={row} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <nav className="flex flex-wrap items-center gap-1 px-4 pt-3 text-sm">
              {view.kind === 'tree' && (
                <button
                  type="button"
                  onClick={() =>
                    parentId === null ? openHome() : openCategory(currentNode?.parent_id_uuid ?? null)
                  }
                  className="mr-2 rounded-lg border border-primary-border px-2.5 py-1 text-sm text-ink-secondary hover:bg-primary-soft"
                  title="ย้อนขึ้นหนึ่งชั้น"
                >
                  ← ย้อนกลับ
                </button>
              )}
              <button
                type="button"
                onClick={openHome}
                className={isHome ? 'font-semibold text-ink' : 'text-primary hover:underline'}
              >
                Home category (Level 1)
              </button>
              <span className="text-ink-disabled">·</span>
              <button
                type="button"
                onClick={() => openCategory(null)}
                className={
                  view.kind === 'tree' && parentId === null
                    ? 'font-semibold text-ink'
                    : 'text-primary hover:underline'
                }
              >
                Division ทั้งหมด
              </button>
              {trail.map((node) => (
                <React.Fragment key={node.category_id_uuid}>
                  <span className="text-ink-disabled">›</span>
                  <button
                    type="button"
                    onClick={() => openCategory(node.category_id_uuid)}
                    className={
                      node.category_id_uuid === currentNode?.category_id_uuid
                        ? 'font-semibold text-ink'
                        : 'text-primary hover:underline'
                    }
                  >
                    {node.category_name_en}
                  </button>
                </React.Fragment>
              ))}
            </nav>

            {!isHome && parentId && (
              <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary-soft px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {currentNode?.category_name_en}
                    <span className="ml-2 font-normal text-ink-secondary">
                      {currentNode?.category_name_th}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">
                    {levelLabel(currentNode?.category_level ?? 0)}
                  </p>
                </div>
                {currentNode && <RowActions row={currentNode} />}
              </div>
            )}

            <div className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary-border px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs text-ink-muted">{listCaption}</p>
                  {isHome && (
                    <p className="mt-0.5 text-xs text-ink-muted">
                      หน้าแรกยังซ่อนหมวดที่ไม่มีสินค้า active ให้อีกชั้นหนึ่ง — ติ๊กแล้วอาจยังไม่ขึ้น
                      ถ้าหมวดนั้นยังไม่มีสินค้า
                    </p>
                  )}
                  {childrenAreLevel1 && (
                    <button
                      type="button"
                      onClick={openHome}
                      className="mt-0.5 text-xs text-primary hover:underline"
                    >
                      ไปจัดลำดับที่ Home category →
                    </button>
                  )}
                </div>
                {canReorder && (
                  <Button
                    text={saving ? 'กำลังบันทึก...' : dirty ? 'บันทึกลำดับ' : 'ลำดับตรงกับที่บันทึกไว้'}
                    onClick={handleSave}
                    disabled={!dirty || saving}
                  />
                )}
              </div>

              {order.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-ink-muted">
                  {isHome
                    ? 'ยังไม่มีหมวด Level 1'
                    : 'หมวดนี้ไม่มีหมวดย่อย — เป็นหมวดปลายกิ่งที่สินค้าผูกอยู่'}
                </p>
              ) : (
                <>
                  {/* หัวตาราง — ponytail: ชื่อ EN/TH รวมเป็นคอลัมน์เดียวเพราะข้อมูลแถวเดิมแสดงคู่กันมาตลอด
                   * แยกเป็น 2 คอลัมน์ตาม Figma เมื่อ redesign แถวให้มีชื่อ EN/TH เป็นฟิลด์แยกจริง ๆ */}
                  <div className="flex h-12 items-center gap-3 border-b border-primary-border px-3 text-sm font-semibold text-ink">
                    <span className="w-5 shrink-0" />
                    <span className="w-6 shrink-0 text-center">ลำดับ</span>
                    <span className="w-16 shrink-0">รูป</span>
                    <span className="min-w-0 flex-1">ชื่อหมวดหมู่</span>
                  </div>
                  <DragDropContext onDragEnd={handleDragEnd}>
                    <Droppable droppableId={isHome ? 'level1' : (parentId ?? 'root')}>
                      {(dropProvided) => (
                        <ul
                          {...dropProvided.droppableProps}
                          ref={dropProvided.innerRef}
                          className="divide-y divide-line"
                        >
                          {order.map((row, index) => {
                            const childCount = childrenOf(rows, row.category_id_uuid).length;
                            const parent = row.parent_id_uuid
                              ? byId.get(row.parent_id_uuid)
                              : undefined;
                            return (
                              <Draggable
                                key={row.category_id_uuid}
                                draggableId={row.category_id_uuid}
                                index={index}
                                isDragDisabled={!canReorder}
                              >
                                {(dragProvided, snapshot) => (
                                  <li
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    className={`flex h-16 items-center gap-3 bg-white px-3 ${
                                      snapshot.isDragging ? 'rounded-lg shadow-level-1' : ''
                                    } ${
                                      isHome && row.show_on_homepage === false ? 'opacity-60' : ''
                                    }`}
                                  >
                                    <span
                                      {...dragProvided.dragHandleProps}
                                      className={
                                        canReorder
                                          ? 'cursor-grab text-ink-muted hover:text-ink-secondary'
                                          : 'text-ink-disabled'
                                      }
                                      title={canReorder ? 'ลากเพื่อจัดลำดับ' : 'ชั้นนี้จัดลำดับที่นี่ไม่ได้'}
                                    >
                                      <MdDragIndicator size={20} />
                                    </span>

                                    <span className="w-6 shrink-0 text-center text-xs text-ink-muted">
                                      {index + 1}
                                    </span>

                                    <CategoryThumb url={row.category_image} />

                                    <button
                                      type="button"
                                      onClick={() => openCategory(row.category_id_uuid)}
                                      disabled={childCount === 0}
                                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                                      title={
                                        childCount > 0
                                          ? `เปิดดูหมวดย่อย ${childCount} หมวด`
                                          : 'ไม่มีหมวดย่อย'
                                      }
                                    >
                                      <p className="truncate text-sm font-medium text-ink">
                                        {row.category_name_en}
                                        {row.category_name_th ? (
                                          <span className="ml-2 font-normal text-ink-secondary">
                                            {row.category_name_th}
                                          </span>
                                        ) : null}
                                        {childCount > 0 && (
                                          <span className="ml-2 text-xs text-primary">
                                            › {childCount} หมวดย่อย
                                          </span>
                                        )}
                                      </p>
                                      <p className="truncate font-mono text-xs text-ink-muted">
                                        {/* Home view ไม่ได้จัดกลุ่มตาม Division แล้ว — แต่ละแถวจึงต้องบอกเองว่ามาจากไหน */}
                                        {isHome && (
                                          <span className="font-sans text-ink-muted">
                                            {parent?.category_name_en ?? 'ไม่มีหมวดแม่'} ›{' '}
                                          </span>
                                        )}
                                        รหัส {row.category_code ?? '—'}
                                        {row.is_active === false ? ' · ปิดใช้งาน' : ''}
                                      </p>
                                    </button>

                                    {row.category_level === 1 && (
                                      <label
                                        className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-secondary"
                                        title="ติ๊กแล้วหมวดนี้จะขึ้นบนแถวไอคอนหน้าแรกของ shop"
                                      >
                                        <input
                                          type="checkbox"
                                          className="accent-primary"
                                          checked={row.show_on_homepage !== false}
                                          disabled={toggleHomepage.isPending}
                                          onChange={(e) =>
                                            toggleHomepage.mutate({
                                              id: row.category_id_uuid,
                                              show: e.target.checked,
                                            })
                                          }
                                        />
                                        แสดงบนหน้าแรก
                                      </label>
                                    )}

                                    <RowActions row={row} />
                                  </li>
                                )}
                              </Draggable>
                            );
                          })}
                          {dropProvided.placeholder}
                        </ul>
                      )}
                    </Droppable>
                  </DragDropContext>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CategoryList;

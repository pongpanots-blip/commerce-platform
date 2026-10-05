import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import {
  listCuisineCardsAdmin,
  reorderCuisineCardsAdmin,
  updateCuisineCardAdmin,
  type ShopCuisineCardAdmin,
} from '@josh/shared-api';
import { Button, Input } from '@josh/shared-ui-web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AiOutlineEdit, AiOutlineSearch } from 'react-icons/ai';
import { HiOutlineExternalLink } from 'react-icons/hi';
import { MdDragIndicator } from 'react-icons/md';
import AdminListHeader from '../../components/AdminListHeader';
import { CopyIdButton } from '../../components/CopyIdButton';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { resolveAdminAssetUrl } from '../../lib/asset-url';
import { moveItem, orderChanged } from '../category/category-tree.helpers';
import { CUISINE_CARDS_QUERY_KEY, searchCuisineCards } from './cuisine-cards.helpers';

const NO_CARDS: ShopCuisineCardAdmin[] = [];

function CardThumb({ url }: { url?: string | null }) {
  const src = resolveAdminAssetUrl(url);
  return src ? (
    <img src={src} alt="" className="h-16 w-16 shrink-0 object-cover" />
  ) : (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center bg-primary-soft text-lg">
      🍽️
    </span>
  );
}

function RowActions({ card }: { card: ShopCuisineCardAdmin }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <CopyIdButton id={card.id} />
      <Link
        to={ADMIN_ROUTES.cuisineCardEdit(card.id)}
        className="rounded-lg p-1.5 text-ink-muted hover:bg-primary-soft hover:text-primary"
        title="แก้ไขการ์ด"
      >
        <AiOutlineEdit size={18} />
      </Link>
      <a
        href={`/shop/product/cuisine/${card.id}`}
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
 * `/admin/cuisine-cards` — ลิสต์การ์ด "Shop by Cuisine" ทั้งหมด (active + inactive)
 * ลากจัดลำดับได้ (`PUT /cuisine/cards/order`) และติ๊ก "แสดงบนหน้าแรก" ได้ในแถวแบบ optimistic
 * เหมือนหน้า Categories — แก้เนื้อหา/รูป/taxonomy ที่หน้าแก้ไขแยกต่างหาก
 */
export default function CuisineCardsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: CUISINE_CARDS_QUERY_KEY,
    queryFn: listCuisineCardsAdmin,
    staleTime: 60_000,
  });
  const cards = data ?? NO_CARDS;

  const [order, setOrder] = useState<ShopCuisineCardAdmin[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setOrder(cards);
    setError('');
  }, [cards]);

  const dirty = orderChanged(cards, order, (card) => card.id);
  const results = searchCuisineCards(cards, search);
  const isSearching = search.trim().length > 0;

  /* ติ๊ก/ปลดติ๊ก "แสดงบนหน้าแรก" ในแถว — optimistic แล้วย้อนกลับถ้า API พัง (เหมือน toggleHomepage
   * ในหน้า Categories) */
  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      updateCuisineCardAdmin(id, { is_active: active }),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: CUISINE_CARDS_QUERY_KEY });
      const previous = queryClient.getQueryData<ShopCuisineCardAdmin[]>(CUISINE_CARDS_QUERY_KEY);
      queryClient.setQueryData<ShopCuisineCardAdmin[]>(CUISINE_CARDS_QUERY_KEY, (current) =>
        current?.map((card) => (card.id === id ? { ...card, is_active: active } : card)),
      );
      setError('');
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(CUISINE_CARDS_QUERY_KEY, context.previous);
      }
      setError('บันทึกการแสดงบนหน้าแรกไม่สำเร็จ');
    },
  });

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    setOrder((current) => moveItem(current, result.source.index, result.destination!.index));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await reorderCuisineCardsAdmin(order.map((card) => card.id));
      await queryClient.invalidateQueries({ queryKey: CUISINE_CARDS_QUERY_KEY });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'บันทึกลำดับไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
  }

  const activeCount = cards.filter((card) => card.is_active).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <AdminListHeader
        title="Shop by Cuisine"
        subtitle="การ์ดหน้าแรก shop — ลากจัดลำดับ ติ๊กแสดง/ซ่อน แล้วแก้เนื้อหา/รูปที่หน้าแก้ไข"
        createLabel="เพิ่มการ์ด"
        createPath={ADMIN_ROUTES.cuisineCardCreate}
      />

      {error && (
        <p className="rounded-lg border border-alert/30 bg-alert-soft px-4 py-2 text-sm text-alert">
          {error}
        </p>
      )}

      <div className="rounded-lg bg-white shadow-level-1">
        <div className="flex justify-end gap-3 border-b border-primary-border p-3">
          <Input
            icon={<AiOutlineSearch size={20} />}
            className="md:w-[296px]"
            placeholder="ชื่อ EN / TH / slug / รหัส"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isSearching ? (
          <div>
            <p className="border-b border-line px-4 py-2 text-xs text-ink-muted">
              ผลค้นหา {results.length} การ์ด — ล้างคำค้นเพื่อจัดลำดับ / เปิด-ปิดแสดงบนหน้าแรก
            </p>
            {results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">ไม่พบการ์ดที่ตรงกับคำค้น</p>
            ) : (
              <ul className="divide-y divide-line">
                {results.map((card) => (
                  <li key={card.id} className="flex h-16 items-center gap-3 px-3">
                    <CardThumb url={card.image_url ?? card.image_url_desktop} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {card.title_en}
                        <span className="ml-2 font-normal text-ink-secondary">{card.title_th}</span>
                      </p>
                      <p className="truncate font-mono text-xs text-ink-muted">{card.slug}</p>
                    </div>
                    <RowActions card={card} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary-border px-4 py-2.5">
              <p className="text-xs text-ink-muted">
                ทั้งหมด {order.length} การ์ด · แสดงบนหน้าแรก {activeCount} การ์ด — ลากเพื่อจัดลำดับ
                แล้วกดบันทึก
              </p>
              <Button
                text={saving ? 'กำลังบันทึก...' : 'บันทึกลำดับ'}
                onClick={handleSave}
                disabled={!dirty || saving}
              />
            </div>

            {order.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-muted">
                ยังไม่มีการ์ด — กด “เพิ่มการ์ด” เพื่อสร้าง
              </p>
            ) : (
              <>
                <div className="flex h-12 items-center gap-3 border-b border-primary-border px-3 text-sm font-semibold text-ink">
                  <span className="w-5 shrink-0" />
                  <span className="w-6 shrink-0 text-center">ลำดับ</span>
                  <span className="w-16 shrink-0">รูป</span>
                  <span className="min-w-0 flex-1">ชื่อการ์ด</span>
                  <span className="shrink-0">แสดงบนหน้าแรก</span>
                </div>
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="cuisine-cards">
                    {(dropProvided) => (
                      <ul
                        {...dropProvided.droppableProps}
                        ref={dropProvided.innerRef}
                        className="divide-y divide-line"
                      >
                        {order.map((card, index) => (
                          <Draggable key={card.id} draggableId={card.id} index={index}>
                            {(dragProvided, snapshot) => (
                              <li
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                className={`flex h-16 items-center gap-3 bg-white px-3 ${
                                  snapshot.isDragging ? 'rounded-lg shadow-level-1' : ''
                                } ${card.is_active ? '' : 'opacity-60'}`}
                              >
                                <span
                                  {...dragProvided.dragHandleProps}
                                  className="cursor-grab text-ink-muted hover:text-ink-secondary"
                                  title="ลากเพื่อจัดลำดับ"
                                >
                                  <MdDragIndicator size={20} />
                                </span>

                                <span className="w-6 shrink-0 text-center text-xs text-ink-muted">
                                  {index + 1}
                                </span>

                                <CardThumb url={card.image_url ?? card.image_url_desktop} />

                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-ink">
                                    {card.title_en}
                                    <span className="ml-2 font-normal text-ink-secondary">
                                      {card.title_th}
                                    </span>
                                  </p>
                                  <p className="truncate font-mono text-xs text-ink-muted">
                                    {card.slug}
                                    {card.cuisine_id ? (
                                      ''
                                    ) : (
                                      <span className="ml-2 font-sans text-alert">
                                        ยังไม่ผูก taxonomy
                                      </span>
                                    )}
                                  </p>
                                </div>

                                <label
                                  className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-secondary"
                                  title="ติ๊กแล้วการ์ดนี้จะขึ้นบนหน้าแรกของ shop"
                                >
                                  <input
                                    type="checkbox"
                                    className="accent-primary"
                                    checked={card.is_active}
                                    disabled={toggleActive.isPending}
                                    onChange={(e) =>
                                      toggleActive.mutate({ id: card.id, active: e.target.checked })
                                    }
                                  />
                                  แสดงบนหน้าแรก
                                </label>

                                <RowActions card={card} />
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
        )}
      </div>
    </div>
  );
}

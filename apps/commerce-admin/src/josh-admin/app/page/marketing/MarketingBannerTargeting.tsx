import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  addSegmentPromotion,
  getBannerTargetingRules,
  getUserSegments,
  removeSegmentPromotion,
  updateSegmentPromotionMapping,
  type BannerTargetingRule,
  type UserSegmentListItem,
} from '@josh/shared-api';
import { Select } from '@josh/shared-ui-web';
import { MdDragIndicator, MdOutlineClose } from 'react-icons/md';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { useBannerLibrary } from '../../components/marketing/banner-library';

/**
 * กติกาเลือก banner หน้าเว็บต่อผู้ชม (Braze-style): แถวบน = priority สูงกว่า
 * banner ของทุกกติกาที่ผู้ชม match จะขึ้น hero ก่อน banner ปกติ ตามลำดับในลิสต์นี้
 */
export default function MarketingBannerTargeting() {
  const [rules, setRules] = useState<BannerTargetingRule[]>([]);
  const [segments, setSegments] = useState<UserSegmentListItem[]>([]);
  const banners = useBannerLibrary();
  const [newSegmentId, setNewSegmentId] = useState('');
  const [newBannerUrl, setNewBannerUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const segmentSelectId = useId();
  const bannerSelectId = useId();

  const bannerIdByUrl = new Map(banners.map((b) => [b.url, b]));

  const load = () => {
    getBannerTargetingRules()
      .then(setRules)
      .catch(() => setRules([]));
  };

  useEffect(() => {
    load();
    getUserSegments()
      .then(setSegments)
      .catch(() => setSegments([]));
  }, []);

  /** Persist the list order as sort_order 0..n (only changed rows are PATCHed). */
  const persistOrder = async (next: BannerTargetingRule[]) => {
    setRules(next.map((rule, index) => ({ ...rule, sort_order: index })));
    await Promise.all(
      next.map((rule, index) =>
        rule.sort_order === index
          ? Promise.resolve()
          : updateSegmentPromotionMapping(rule.mapping_id, { sort_order: index }).catch(
              () => undefined,
            ),
      ),
    );
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const next = [...rules];
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    void persistOrder(next);
  };

  const handleToggle = async (rule: BannerTargetingRule) => {
    setRules((prev) =>
      prev.map((r) =>
        r.mapping_id === rule.mapping_id ? { ...r, is_active: !r.is_active } : r,
      ),
    );
    await updateSegmentPromotionMapping(rule.mapping_id, {
      is_active: !rule.is_active,
    }).catch(() => load());
  };

  const handleRemove = async (rule: BannerTargetingRule) => {
    setRules((prev) => prev.filter((r) => r.mapping_id !== rule.mapping_id));
    await removeSegmentPromotion(rule.segment_id, rule.mapping_id).catch(() => load());
  };

  const handleAdd = async () => {
    const banner = bannerIdByUrl.get(newBannerUrl);
    if (!newSegmentId || !banner) {
      setError('เลือกทั้งเงื่อนไข (segment) และ banner ก่อน');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // banner library exposes url; map back to the banner row id via /banner list
      const bannerId = (banner as { id?: string }).id;
      if (!bannerId) {
        setError('ไม่พบ id ของ banner นี้');
        return;
      }
      await addSegmentPromotion(newSegmentId, {
        promotion_type: 'banner',
        promotion_id: bannerId,
        sort_order: rules.length,
        is_active: true,
      });
      setNewSegmentId('');
      setNewBannerUrl('');
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'เพิ่มกติกาไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Link to={ADMIN_ROUTES.marketingWorkflows} className="text-xs text-primary hover:underline">
          &larr; Marketing Workflows
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-800">Banner Targeting</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-500">
          กติกาเลือก banner หน้าเว็บต่อผู้ชม — ผู้ชมที่เข้าเงื่อนไข (segment) จะเห็น banner
          ของกติกานั้นขึ้นก่อน banner ปกติบน hero ของ shop · แถวบน = priority สูงกว่า
          (ลากสลับได้) · ตัวอย่าง: "ยอดสั่งซื้อ &gt; 100" → banner 1, "เข้าเว็บครั้งแรก" →
          banner 3, "ร้าน cuisine ญี่ปุ่น + ยอด &gt; 100" → banner 5 — สร้างเงื่อนไขผสมได้ใน{' '}
          <Link to={ADMIN_ROUTES.segmentBuilderCreate} className="text-primary hover:underline">
            Segment Builder
          </Link>{' '}
          (มี rule "เข้าเว็บครั้งแรก (first_visit)" ให้เลือกด้วย)
        </p>
      </div>

      {/* เพิ่มกติกาใหม่ */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor={segmentSelectId} className="mb-1 block text-xs font-medium text-gray-500">
            เงื่อนไข (User Segment)
          </label>
          <Select
            id={segmentSelectId}
            className="w-full"
            value={newSegmentId}
            onChange={(event) => setNewSegmentId(event.target.value)}
          >
            <option value="">— เลือก segment —</option>
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label htmlFor={bannerSelectId} className="mb-1 block text-xs font-medium text-gray-500">Banner ที่จะแสดง</label>
          <Select
            id={bannerSelectId}
            className="w-full"
            value={newBannerUrl}
            onChange={(event) => setNewBannerUrl(event.target.value)}
          >
            <option value="">— เลือก banner (/admin/banner) —</option>
            {banners.map((banner) => (
              <option key={banner.url} value={banner.url}>
                {banner.title}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={handleAdd}
          className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          + เพิ่มกติกา
        </button>
        {error && <p className="w-full text-xs text-red-500">{error}</p>}
      </div>

      {/* รายการกติกา */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="banner-targeting-rules">
          {(dropProvided) => (
            <div
              ref={dropProvided.innerRef}
              {...dropProvided.droppableProps}
              className="space-y-2"
            >
              {rules.map((rule, index) => (
                <Draggable key={rule.mapping_id} draggableId={rule.mapping_id} index={index}>
                  {(dragProvided, snapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      className={`flex items-center gap-3 rounded-xl border bg-white p-2.5 ${
                        snapshot.isDragging ? 'border-primary shadow-md' : 'border-gray-200'
                      } ${rule.is_active ? '' : 'opacity-50'}`}
                    >
                      <span
                        {...dragProvided.dragHandleProps}
                        className="cursor-grab text-gray-300 hover:text-gray-500"
                        title="ลากเพื่อจัด priority"
                      >
                        <MdDragIndicator size={18} />
                      </span>
                      <span className="w-8 text-center text-xs font-bold text-gray-400">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-800">
                          {rule.segment_name}
                          {rule.segment_rule_type === 'first_visit' && (
                            <span className="ml-1.5 rounded bg-emerald-100 px-1 py-px text-[9px] font-semibold text-emerald-600">
                              เข้าเว็บครั้งแรก
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-gray-400">
                          เห็น: {rule.banner_title || rule.banner_id.slice(0, 8)}
                        </p>
                      </div>
                      {rule.banner_image && (
                        <img
                          src={
                            /^https?:\/\//i.test(rule.banner_image)
                              ? rule.banner_image
                              : undefined
                          }
                          alt=""
                          className="h-10 w-20 rounded-md object-cover"
                          onError={(event) => {
                            (event.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}
                      <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        <input
                          type="checkbox"
                          checked={rule.is_active}
                          onChange={() => handleToggle(rule)}
                        />
                        เปิดใช้
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemove(rule)}
                        className="rounded p-1 text-gray-300 hover:text-red-500"
                        title="ลบกติกานี้"
                      >
                        <MdOutlineClose size={16} />
                      </button>
                    </div>
                  )}
                </Draggable>
              ))}
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
      {rules.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
          ยังไม่มีกติกา — เลือก segment + banner ด้านบนเพื่อเพิ่มกติกาแรก
        </p>
      )}
    </div>
  );
}

// ui-metadata-migration: static labels and UI notices only
import {
  createPromotionProductSet,
  getPromotionBrandProducts,
  getPromotionCategoryProducts,
  getPromotionProductSet,
  updatePromotionProductSet,
  type PromotionProductItem,
} from '@josh/shared-api';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { readReturnTo, withRestoreDraftMarker } from '../../utils/return-to';
import { buildSaveErrorMessage } from '../carousels/carousel-product.helpers';
import { useCategoryRowsQuery } from '../category/category-form';
import PromotionBrandMultiSelect from './PromotionBrandMultiSelect';
import PromotionCategoryMultiSelect from './PromotionCategoryMultiSelect';
import PromotionProductSetPanel from './PromotionProductSetPanel';
import { EditHistorySection } from '../promotion-common';
import {
  buildProductSetInput,
  buildPromotionSaveErrorMessage,
  splitItemsBySource,
} from './promotion-product-set.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const PromotionProductSetForm = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // Set when this page was reached from a coupon form's product-set picker — send the admin
  // back there instead of the product-set list on save/cancel.
  const returnTo = readReturnTo(searchParams);
  // The `restoreDraft` marker only ever belongs on this specific navigation (back/cancel or a
  // successful save) — never on `returnTo` itself. See return-to.ts and coupon-form-draft.helpers.ts.
  const returnDestination = returnTo ? withRestoreDraftMarker(returnTo) : null;
  const { rows: categoryRows } = useCategoryRowsQuery();

  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // error ของแต่ละ preview effect แยกกัน — สำเร็จของหมวดต้องไม่ไปล้าง error ของแบรนด์ (หรือ error โหลด/บันทึก) ทิ้ง
  const [previewError, setPreviewError] = useState<{ category: string; brand: string }>({
    category: '',
    brand: '',
  });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [manualItems, setManualItems] = useState<PromotionProductItem[]>([]);
  const [categoryItems, setCategoryItems] = useState<PromotionProductItem[]>([]);
  const [brandItems, setBrandItems] = useState<PromotionProductItem[]>([]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      setLoading(true);
      try {
        const detail = await getPromotionProductSet(id);
        setName(detail.name);
        setDescription(detail.description ?? '');
        setIsActive(detail.isActive);
        setCategoryIds(detail.categoryIds);
        setBrandIds(detail.brandIds);
        const { manual } = splitItemsBySource(detail.items);
        setManualItems(manual);
      } catch (err) {
        setError(buildSaveErrorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // ทุกครั้งที่ categoryIds เปลี่ยน — ดึงสินค้าที่มาจากหมวดใหม่มาแทนที่ของเดิม
  const categoryKey = categoryIds.join(',');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getPromotionCategoryProducts(categoryIds);
        if (cancelled) return;
        setCategoryItems(rows.map((item) => ({ ...item, source: 'category' as const })));
        setPreviewError((prev) => ({ ...prev, category: '' }));
      } catch (err) {
        if (cancelled) return;
        setPreviewError((prev) => ({ ...prev, category: buildSaveErrorMessage(err) }));
      }
    })();
    // กันเคสยิงเลือกหมวดถี่ๆ แล้ว response เก่ามาถึงทีหลัง response ใหม่ — ตัวหลังเท่านั้นที่ set state ได้
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryKey]);

  // ทุกครั้งที่ brandIds เปลี่ยน — ดึงสินค้าที่มาจากแบรนด์ใหม่มาแทนที่ของเดิม
  const brandKey = brandIds.join(',');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getPromotionBrandProducts(brandIds);
        if (cancelled) return;
        setBrandItems(rows.map((item) => ({ ...item, source: 'brand' as const })));
        setPreviewError((prev) => ({ ...prev, brand: '' }));
      } catch (err) {
        if (cancelled) return;
        setPreviewError((prev) => ({ ...prev, brand: buildSaveErrorMessage(err) }));
      }
    })();
    // กันเคสยิงเลือกแบรนด์ถี่ๆ แล้ว response เก่ามาถึงทีหลัง response ใหม่ — ตัวหลังเท่านั้นที่ set state ได้
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandKey]);

  const handleSave = async () => {
    if (!name.trim()) {
      alert(__uiText("กรุณาระบุชื่อ Product Set"));
      return;
    }
    setSaving(true);
    setError('');
    const input = buildProductSetInput({
      name,
      description,
      isActive,
      manualItems,
      categoryIds,
      brandIds,
    });
    try {
      if (id) {
        await updatePromotionProductSet(id, input);
        navigate(returnDestination ?? ADMIN_ROUTES.promotionProductSets);
      } else {
        const created = await createPromotionProductSet(input);
        // Normally lands on the edit page so the admin can keep working on the new set — but
        // arriving here from a coupon form's picker means they came to create one set and go
        // straight back, not to linger here.
        navigate(returnDestination ?? ADMIN_ROUTES.promotionProductSetEdit(created.id));
      }
    } catch (err) {
      setError(buildPromotionSaveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="cp-management-page text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  return (
    <div className="cp-page-panel space-y-6 bg-white border border-secondary-container rounded-xl p-4 md:p-6">
      <header className="flex items-center justify-between border-b pb-4">
        <h1 className="text-2xl font-black text-gray-800">
          {id ? __uiText("แก้ไข Promotion Product Set") : __uiText("สร้าง Promotion Product Set")}
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate(returnDestination ?? ADMIN_ROUTES.promotionProductSets)}
            className="rounded-lg px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100"
          >
            {__uiText("ยกเลิก")}</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-bold text-white shadow-md hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? __uiText("กำลังบันทึก…") : __uiText("บันทึก")}
          </button>
        </div>
      </header>

      {error && <p className="text-sm text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
      {previewError.category && <p className="text-sm text-red-600">{(typeof (previewError.category) === 'string' ? __uiText(previewError.category) : previewError.category)}</p>}
      {previewError.brand && <p className="text-sm text-red-600">{(typeof (previewError.brand) === 'string' ? __uiText(previewError.brand) : previewError.brand)}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-fit min-w-0 space-y-4 rounded-2xl border border-gray-100 p-5 shadow-sm lg:col-span-1">
          <h3 className="border-b pb-2 font-bold text-gray-700">{__uiText("ตั้งค่า Product Set")}</h3>

          <div>
            <label htmlFor="pps-name" className="text-xs font-bold uppercase text-gray-400">
              {__uiText("ชื่อ")}</label>
            <input
              id="pps-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={__uiText("เช่น หมวดเนื้อสัตว์โปรโมชั่น")}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ring-primary/10 focus:ring-2"
            />
          </div>

          <div>
            <label htmlFor="pps-description" className="text-xs font-bold uppercase text-gray-400">
              {__uiText("คำอธิบาย")}</label>
            <textarea
              id="pps-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ring-primary/10 focus:ring-2"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            {__uiText("เปิดใช้งาน")}</label>

          <div>
            <span className="text-xs font-bold uppercase text-gray-400">{__uiText("หมวดหมู่ที่ผูกอัตโนมัติ")}</span>
            <p className="mb-1 text-[11px] text-gray-400">
              {__uiText("ติ๊กหมวดหมู่ → สินค้าทั้งหมดในหมวดถูกเพิ่มเข้ารายการอัตโนมัติ ยกเลิกติ๊กเพื่อเอาออก")}</p>
            <PromotionCategoryMultiSelect
              rows={categoryRows}
              selectedIds={categoryIds}
              onChange={setCategoryIds}
            />
          </div>

          <div>
            <span className="text-xs font-bold uppercase text-gray-400">{__uiText("แบรนด์ที่ผูกอัตโนมัติ")}</span>
            <p className="mb-1 text-[11px] text-gray-400">
              {__uiText("เลือกแบรนด์ → สินค้าทั้งหมดของแบรนด์ถูกเพิ่มเข้ารายการอัตโนมัติ ยกเลิกเลือกเพื่อเอาออก")}</p>
            <PromotionBrandMultiSelect selectedIds={brandIds} onChange={setBrandIds} />
          </div>
        </div>

        <div className="min-w-0 lg:col-span-2">
          <PromotionProductSetPanel
            manualItems={manualItems}
            categoryItems={categoryItems}
            brandItems={brandItems}
            onManualChange={setManualItems}
          />
        </div>
      </div>

      {id && (
        <EditHistorySection
          entityType="promotion_product_set"
          entityId={id}
          names={Object.fromEntries(
            categoryRows.map((row) => [
              row.category_id_uuid,
              row.category_name_th || row.category_name_en || row.category_id_uuid,
            ]),
          )}
        />
      )}
    </div>
  );
};

export default PromotionProductSetForm;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

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
import { Alert, Button, Checkbox, FormField, Input, PageHeader, Panel, PanelHead, inputCls, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
      alert(__uiText("กรุณาระบุชื่อชุดสินค้า"));
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

  const leave = () => navigate(returnDestination ?? ADMIN_ROUTES.promotionProductSets);

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <PageHeader
        back={{ to: returnDestination ?? ADMIN_ROUTES.promotionProductSets, label: 'กลับ' }}
        title={id ? __uiText("แก้ไขชุดสินค้าโปรโมชัน") : __uiText("เพิ่มชุดสินค้าโปรโมชัน")}
        subtitle={__uiText("ตั้งชื่อชุด แล้วเลือกหมวดหมู่ แบรนด์ หรือสินค้าที่อยู่ในชุดนี้")}
      />

      {error && <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert>}
      {previewError.category && <Alert tone="danger">{(typeof (previewError.category) === 'string' ? __uiText(previewError.category) : previewError.category)}</Alert>}
      {previewError.brand && <Alert tone="danger">{(typeof (previewError.brand) === 'string' ? __uiText(previewError.brand) : previewError.brand)}</Alert>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel className="h-fit lg:col-span-1">
          <PanelHead title={__uiText("ตั้งค่าชุดสินค้า")} />
          <div className="space-y-4 p-5">
            <FormField label={__uiText("ชื่อ")} required>
              <Input
                id="pps-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={__uiText("เช่น หมวดเนื้อสัตว์โปรโมชั่น")}
              />
            </FormField>

            <FormField label={__uiText("คำอธิบาย")}>
              <textarea
                id="pps-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={inputCls}
              />
            </FormField>

            <Checkbox
              label={__uiText("เปิดใช้งาน")}
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-on-surface">{__uiText("หมวดหมู่ที่ผูกอัตโนมัติ")}</span>
              <p className="text-[11px] text-outline">
                {__uiText("เลือกหมวดหมู่ แล้วสินค้าทั้งหมดในหมวดจะถูกเพิ่มเข้าชุดเอง เอาออกได้โดยยกเลิกการเลือก")}</p>
              <PromotionCategoryMultiSelect
                rows={categoryRows}
                selectedIds={categoryIds}
                onChange={setCategoryIds}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-on-surface">{__uiText("แบรนด์ที่ผูกอัตโนมัติ")}</span>
              <p className="text-[11px] text-outline">
                {__uiText("เลือกแบรนด์ แล้วสินค้าทั้งหมดของแบรนด์จะถูกเพิ่มเข้าชุดเอง เอาออกได้โดยยกเลิกการเลือก")}</p>
              <PromotionBrandMultiSelect selectedIds={brandIds} onChange={setBrandIds} />
            </div>
          </div>
        </Panel>

        <div className="min-w-0 lg:col-span-2">
          <PromotionProductSetPanel
            manualItems={manualItems}
            categoryItems={categoryItems}
            brandItems={brandItems}
            onManualChange={setManualItems}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={leave}>
          {__uiText("ยกเลิก")}</Button>
        <Button variant="primary" icon="check" disabled={saving} onClick={() => void handleSave()}>
          {saving ? __uiText("กำลังบันทึก…") : __uiText("บันทึก")}
        </Button>
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

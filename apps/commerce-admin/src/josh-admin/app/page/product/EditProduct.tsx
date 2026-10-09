// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
import {
  deleteBulkUploadReplacedImage,
  getBrands,
  getBulkUploadLogs,
  getCuisineCatalog,
  getProductById,
  getProductCuisines,
  getProductPromotionLock,
  restoreBulkUploadReplacedImage,
  setProductCuisines,
  updateProduct,
  type BulkUploadLogItem,
  type CuisineHierarchyItem,
} from '@josh/shared-api';
import { ADMIN_PRODUCT_READ } from '../../config/admin-product-read';
import { LoadError } from '../../components/LoadError';
import { DragDropUpload, Input } from '@josh/shared-ui-web';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  catalogSellingPrice,
  editedPromotionRules,
  saveErrorMessage,
} from './catalog-price';
import {
  PromotionRulesLockedNotice,
  type PromotionRulesLockedBy,
} from './PromotionRulesLockedNotice';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { productPricesApi, session } from '../../../../lib/api';
import { commerceText } from '../../../../app/commerce-copy';
import { productContentAuthority, REVIEWED_PRODUCT_CONTENT_FIELDS } from '../../../libs/shared-api/lib/products/product-content-edit-policy';
import {
  getTranslation,
  ProductMediaItem,
  resolveMediaUrl,
  sortProductMedia,
} from './product-media.helpers';
import {
  EMPTY_NUTRITION_ROW,
  hydrateNutrition,
  toDatetimeLocalValue,
  type NutritionItemRow,
} from './product-nutrition.helpers';
import ProductDetailFormFields from './ProductDetailFormFields';
import PromotionQuantityRuleFields from '../campain/PromotionQuantityRuleFields';
import {
  EMPTY_PROMOTION_MECHANIC_FORM,
  formToPromotionRules,
  hasAnyPromotionPrice,
  parsePromotionRows,
  rulesToForm,
  validatePromotionMechanicForm,
  type PromotionMechanicForm,
} from '../campain/promotion-mechanic.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { ButtonLink, Loading, MasterDataSelect, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const MAX_IMAGES = 3;
const NUTRITION_FORM_KEYS = new Set(['nutrition_basis', 'nutrition_items']);

const EditProduct = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [contentOwned, setContentOwned] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [existingMedia, setExistingMedia] = useState<ProductMediaItem[]>([]);
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([]);
  const [newImages, setNewImages] = useState<File[]>([]);
  const [replacedLogs, setReplacedLogs] = useState<BulkUploadLogItem[]>([]);
  const [replacedLoading, setReplacedLoading] = useState(true);
  const [replacedError, setReplacedError] = useState<string | null>(null);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const [restoringLogId, setRestoringLogId] = useState<string | null>(null);
  const [showReplaced, setShowReplaced] = useState(false);
  const [tierForm, setTierForm] = useState<PromotionMechanicForm>({
    ...EMPTY_PROMOTION_MECHANIC_FORM,
    rules: [...EMPTY_PROMOTION_MECHANIC_FORM.rules],
  });
  // Tier rows as loaded — promotion_rules is posted only when they differ (see editedPromotionRules).
  const initialRulesRef = useRef<string | null>(null);
  // Set when a promotion mechanic owns this SKU's price tiers: shown read-only, never posted.
  const [rulesLockedBy, setRulesLockedBy] = useState<PromotionRulesLockedBy | null>(null);
  const [mechanicHasTiers, setMechanicHasTiers] = useState(false);
  const [cuisineCatalog, setCuisineCatalog] = useState<CuisineHierarchyItem[]>(
    [],
  );
  const [selectedCuisineIds, setSelectedCuisineIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    product_inventory_sku: '',
    product_status: '1',
    product_inventory_quantity: '',
    selling_unit: 'ชิ้น',
    brand_name: '',
    brand_code: '',
    marketed_by: '',
    vat_type: '',
    storage_temperature: '',
    product_name_th: '',
    product_description_th: '',
    product_name_en: '',
    product_description_en: '',
    ingredients: '',
    allergens: '',
    expiration_info: '',
    storage_instruction: '',
    usage_direction: '',
    expected_restock_at: '',
    nutrition_basis: '',
    nutrition_items: [{ ...EMPTY_NUTRITION_ROW }] as NutritionItemRow[],
  });

  const [brandOptions, setBrandOptions] = useState<{ value: string; label: string }[]>([]);
  // Read-only here: Josh's selling_price is the sell-unit total from ERP PRICE (commerce owns it via product.price.snapshot
  // orderingPrice), and the avg is derived from it. Josh no longer stores a per-selling-unit rate to edit.
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [avgPrice, setAvgPrice] = useState<string>('');
  const [orderTakingUnit, setOrderTakingUnit] = useState<string>('');

  useEffect(() => {
    getBrands()
      .then((response: any) => {
        const rows = response?.data?.data ?? [];
        setBrandOptions(
          rows.map((b: any) => ({
            value: b.brand_code,
            label: `${b.brand_code} — ${b.brand_name_th || b.brand_name_en || 'ยังไม่มีชื่อ'}`,
          })),
        );
      })
      .catch(() => setBrandOptions([]));
  }, []);

  useEffect(() => {
    void getCuisineCatalog()
      .then((rows) => setCuisineCatalog(rows))
      .catch(() => setCuisineCatalog([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    let active = true;
    Promise.all([
      getProductById(id, ADMIN_PRODUCT_READ),
      getProductCuisines(id),
      productPricesApi.ownership(),
      // Admin-only endpoint (the public detail must not carry a mechanic name). A failure leaves the
      // tiers editable — the backend still answers 400 to promotion_rules for a mechanic-owned SKU.
      getProductPromotionLock(id).catch(() => null),
    ])
      .then(([response, cuisines, currentOwnership, lock]) => {
        if (!active) return;
        const data = response.data;
        if (!data) { setLoadError(__uiMessage('ไม่พบสินค้านี้')); return; }
        setContentOwned(productContentAuthority(currentOwnership));

        const translations = data.translations ?? [];
        const th = getTranslation(translations, 'th');
        const en = getTranslation(translations, 'en');
        const nutrition = hydrateNutrition(data.nutrition);

        setForm({
          product_inventory_sku: data.product_inventory_sku ?? '',
          product_status: String(data.product_status ?? 1),
          product_inventory_quantity: String(data.product_inventory_quantity ?? ''),
          selling_unit: String(data.selling_unit ?? data.product_unit ?? 'ชิ้น'),
          brand_name: data.brand_name ?? '',
          brand_code: data.brand_code ?? '',
          marketed_by: data.marketed_by ?? '',
          vat_type: data.vat_type ?? '',
          storage_temperature: data.storage_temperature ?? '',
          product_name_th: th?.product_name ?? data.product_name ?? '',
          product_description_th: th?.product_description ?? data.product_description ?? '',
          product_name_en: en?.product_name ?? '',
          product_description_en: en?.product_description ?? '',
          ingredients: data.ingredients ?? '',
          allergens: data.allergens ?? '',
          expiration_info: data.expiration_info ?? '',
          storage_instruction: data.storage_instruction ?? '',
          usage_direction: data.usage_direction ?? '',
          expected_restock_at: toDatetimeLocalValue(data.expected_restock_at),
          nutrition_basis: nutrition.nutrition_basis,
          nutrition_items: nutrition.nutrition_items,
        });
        const loadedTierForm = rulesToForm(
          data.promotion_rules ?? data.tier_prices,
          // No price default — a tier price is its own sell-unit total, not the catalog one.
          undefined,
          String(data.selling_unit ?? data.product_unit ?? 'ชิ้น'),
        );
        initialRulesRef.current = JSON.stringify(formToPromotionRules(loadedTierForm));
        setTierForm(loadedTierForm);
        setRulesLockedBy(lock);
        // The form's default row is not the mechanic's: only tiers the product response carries are.
        setMechanicHasTiers(parsePromotionRows(data.promotion_rules ?? data.tier_prices).length > 0);
        // The detail payload is priced like the shop; base_selling_price is always the catalog price.
        const catalogSelling = catalogSellingPrice(data);
        setSellingPrice(catalogSelling == null ? '' : String(catalogSelling));
        setAvgPrice(data.avg_price_max == null ? '' : `${data.avg_price_max} / ${data.avg_price_unit ?? ''}`);
        setOrderTakingUnit(String(data.order_taking_unit ?? ''));
        setExistingMedia(sortProductMedia(data.media ?? []));
        setSelectedCuisineIds(cuisines.map((row) => row.id));
      })
      .catch((error: unknown) => { if (active) setLoadError(error); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, reload]);

  const fetchReplacedLogs = () => {
    if (!id) return;
    getBulkUploadLogs({ productInventoryId: id, replacedOnly: true, limit: 100 })
      .then((response) => {
        const items: BulkUploadLogItem[] = response.data?.data?.items ?? [];
        // Rows already deleted server-side are just noise here.
        setReplacedLogs(items.filter((item) => !item.replacedDeletedAt));
      })
      .catch((error: unknown) => setReplacedError(error instanceof Error ? error.message : String(error)))
      .finally(() => setReplacedLoading(false));
  };

  useEffect(fetchReplacedLogs, [id]);

  // Refreshes only the gallery, not the whole product-loading effect above —
  // a full refetch would clobber any unsaved edits elsewhere in the form.
  const fetchExistingMedia = () => {
    if (!id) return;
    getProductById(id, ADMIN_PRODUCT_READ).then((response) => {
      if (response.data) setExistingMedia(sortProductMedia(response.data.media ?? []));
    }).catch((error: unknown) => setReplacedError(error instanceof Error ? error.message : String(error)));
  };

  const handleDeleteReplaced = async (logId: string) => {
    if (!window.confirm(__uiText("ยืนยันลบรูปเก่านี้ถาวร? การลบนี้ย้อนกลับไม่ได้"))) return;
    setDeletingLogId(logId);
    setReplacedError(null);
    try {
      const response = await deleteBulkUploadReplacedImage(logId);
      if (response.data?.statusCode === 200) {
        setReplacedLogs((prev) => prev.filter((item) => item.logId !== logId));
      } else {
        setReplacedError(response.data?.message ?? __uiMessage("ลบไม่สำเร็จ"));
      }
    } catch (error: any) {
      setReplacedError(
        error?.response?.status === 409
          ? error.response.data?.message ?? __uiMessage("รูปนี้ยังถูกใช้งานอยู่ ลบไม่ได้")
          : __uiMessage("เกิดข้อผิดพลาดในการลบ"),
      );
    } finally {
      setDeletingLogId(null);
    }
  };

  const handleRestoreReplaced = async (logId: string) => {
    if (!window.confirm(__uiText("ยืนยันสลับไปใช้รูปนี้แทนรูปปัจจุบัน?"))) return;
    setRestoringLogId(logId);
    setReplacedError(null);
    try {
      const response = await restoreBulkUploadReplacedImage(logId);
      if (response.data?.statusCode === 200) {
        fetchExistingMedia();
        fetchReplacedLogs();
      } else {
        setReplacedError(response.data?.message ?? __uiMessage("สลับรูปไม่สำเร็จ"));
      }
    } catch (error: any) {
      setReplacedError(error?.response?.data?.message ?? __uiMessage("เกิดข้อผิดพลาดในการสลับรูป"));
    } finally {
      setRestoringLogId(null);
    }
  };

  const activeExistingImages = useMemo(
    () =>
      existingMedia.filter(
        (item) =>
          item.media_type === 'image' && !removedMediaIds.includes(item.product_media_id),
      ),
    [existingMedia, removedMediaIds],
  );

  const totalImageCount = activeExistingImages.length + newImages.length;
  const canAddImage = totalImageCount < MAX_IMAGES;

  const handleInput = (name: string, value: string) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddImage = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert(__uiText("กรุณาเลือกไฟล์รูปภาพเท่านั้น"));
      return;
    }
    if (!canAddImage) {
      alert(__uiText("อัปโหลดรูปภาพได้สูงสุด {0} รูป", {"0": MAX_IMAGES}));
      return;
    }
    setNewImages((prev) => [...prev, file]);
  };

  const handleSubmit = async () => {
    if (!id) return false;
    if (!form.product_inventory_sku || (!contentOwned && (!form.product_name_th || !form.product_name_en))) {
      alert(__uiText("กรุณากรอกรหัสสินค้าและชื่อสินค้าทั้ง 2 ภาษา"));
      return false;
    }

    const graphic = session.claims()?.role === 'graphic';

    if (totalImageCount > MAX_IMAGES) {
      alert(__uiText("รูปภาพได้สูงสุด {0} รูป", {"0": MAX_IMAGES}));
      return false;
    }

    // Tier pricing is optional — validate only when a price was typed into a rule row.
    const tierError =
      graphic || rulesLockedBy || !hasAnyPromotionPrice(tierForm) ? null : validatePromotionMechanicForm(tierForm);
    if (tierError) {
      alert(tierError);
      return false;
    }

    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (NUTRITION_FORM_KEYS.has(key)) return;
      if (contentOwned && REVIEWED_PRODUCT_CONTENT_FIELDS.has(key)) return;
      payload.append(key, String(value ?? ''));
    });
    const nutrition = {
      basis: form.nutrition_basis || undefined,
      items: form.nutrition_items.filter((r) => r.label.trim()),
    };
    payload.append(
      'nutrition',
      JSON.stringify(nutrition.items.length || nutrition.basis ? nutrition : null),
    );
    const editedRules = editedPromotionRules(
      formToPromotionRules(tierForm),
      initialRulesRef.current,
      rulesLockedBy !== null,
    );
    if (!graphic && editedRules !== undefined) payload.append('promotion_rules', editedRules);
    payload.append('removed_media_ids', JSON.stringify(removedMediaIds));
    newImages.forEach((file) => payload.append('images', file));

    setSaving(true);
    try {
      const response = await updateProduct(id, payload);
      if (response.data?.statusCode === 200) {
        if (!graphic) {
          try {
            await setProductCuisines(id, selectedCuisineIds);
          } catch {
            alert(__uiText("บันทึกสินค้าแล้ว แต่บันทึก cuisine ไม่สำเร็จ — ลองบันทึกอีกครั้ง"));
            return false;
          }
        }
        navigate(ADMIN_ROUTES.productDetail(id));
        return true;
      }
      alert(response.data?.message ?? __uiText("บันทึกไม่สำเร็จ"));
    } catch (err) {
      // e.g. 400 promotion_rules_locked_by_mechanic — the message names the mechanic
      alert(saveErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึก'));
      return false;
    } finally {
      setSaving(false);
    }
    return false;
  };

  const toggleCuisine = (cuisineId: string) => {
    setSelectedCuisineIds((prev) =>
      prev.includes(cuisineId)
        ? prev.filter((id) => id !== cuisineId)
        : [...prev, cuisineId],
    );
  };

  const cuisineOptions = useMemo(() => {
    const level1 = cuisineCatalog.filter((row) => row.level === 1);
    const level2 = cuisineCatalog.filter((row) => row.level === 2);
    return level1.map((parent) => ({
      parent,
      children: level2.filter((child) => child.parent_id === parent.id),
    }));
  }, [cuisineCatalog]);

  if (loadError) return <LoadError title={__uiText('แก้ไขสินค้า')} error={loadError} onRetry={() => { setLoadError(null); setLoading(true); setReload(value => value + 1); }} />;
  if (loading) {
    return <Loading variant="form" />;
  }

  return (
    <AdminInsertLayout
      title={__uiText("แก้ไขสินค้า")}
      subtitle={__uiText("อัปเดตข้อมูลและรูปภาพ (สูงสุด 3 รูป) — วิดีโอให้ใช้หน้าอัปโหลดวิดีโอ")}
      saveLabel="บันทึกสินค้า"
      steps={['ตรวจชื่อสินค้า', 'แก้ราคาหรือรูป', 'บันทึกสินค้า']}
      backPath={id ? ADMIN_ROUTES.productDetail(id) : ADMIN_ROUTES.products}
      saving={saving}
      onSave={handleSubmit}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label={__uiText("รหัสสินค้า *")}
          hint={__uiText("มาจากระบบหลัก (ERP) แก้ที่นี่ไม่ได้")}
          value={form.product_inventory_sku}
          disabled
          readOnly
        />
        <label className="block text-sm font-medium text-gray-700">
          <span className="mb-1 block">{__uiText("สถานะสินค้า")}</span>
          <select className="w-full border rounded-lg px-3 py-2" value={form.product_status} onChange={(e) => handleInput('product_status', e.target.value)}>
            {form.product_status && !['1', '0'].includes(String(form.product_status)) && <option value={form.product_status}>{form.product_status}</option>}
            <option value="1">{__uiText("ใช้งาน")}</option>
            <option value="0">{__uiText("ปิดการขาย")}</option>
          </select>
        </label>
        <Input
          label={__uiText("จำนวนสต็อก")}
          value={form.product_inventory_quantity}
          onChange={(e) => handleInput('product_inventory_quantity', e.target.value)}
        />
        <Input
          label={__uiText("ชื่อแบรนด์")}
          value={form.brand_name}
          onChange={(e) => handleInput('brand_name', e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{__uiText("แบรนด์")}</label>
          <MasterDataSelect
            aria-label={__uiText("แบรนด์")}
            options={[{ value: '', label: __uiText("ไม่ระบุแบรนด์") }, ...brandOptions]}
            value={form.brand_code}
            onChange={(next) => handleInput('brand_code', String(next))}
          />
        </div>
        <Input
          label={__uiText("ผู้ผลิต/บรรจุ (Marketed By)")}
          value={form.marketed_by}
          onChange={(e) => handleInput('marketed_by', e.target.value)}
        />
        <label className="block text-sm font-medium text-gray-700">
          <span className="mb-1 block">{__uiText("ประเภทภาษีมูลค่าเพิ่ม (VAT Type)")}</span>
          <select className="w-full border rounded-lg px-3 py-2" value={form.vat_type} onChange={(e) => handleInput('vat_type', e.target.value)}>
            <option value="">{__uiText("ค้นหาแล้วเลือก")}</option>
            {form.vat_type && !['0%', '7%'].includes(form.vat_type) && <option value={form.vat_type}>{form.vat_type}</option>}
            <option value="0%">0%</option>
            <option value="7%">7%</option>
          </select>
        </label>
        <Input
          label={__uiText("อุณหภูมิเก็บรักษา")}
          value={form.storage_temperature}
          onChange={(e) => handleInput('storage_temperature', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label={__uiText("ราคาขาย / {0} (฿)", {"0": orderTakingUnit || __uiText("หน่วยสั่ง")})}
          hint={__uiText("ราคาที่ลูกค้าจ่ายจริง แก้ได้ที่ระบบหลัก (ERP) เท่านั้น")}
          value={sellingPrice}
          disabled
        />
        <Input
          label={__uiText("ราคาเฉลี่ยต่อหน่วย (฿)")}
          hint={__uiText("ราคาขาย ÷ ขนาดแพ็ก ที่หน้าร้านแสดงให้เทียบความคุ้ม คำนวณเอง แก้ไม่ได้")}
          value={avgPrice}
          disabled
        />
        <Input
          label={__uiText("หน่วยขาย")}
          value={form.selling_unit}
          onChange={(e) => handleInput('selling_unit', e.target.value)}
          placeholder={__uiText("เช่น ชิ้น")}
        />
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">
          {__uiText("ราคาตามจำนวนซื้อ")}</h3>
        <p className="mb-3 text-xs text-gray-500">
          {__uiText("จำนวนขั้นต่ำแต่ละขั้นต้องไม่ทับกัน ราคาโปรเป็นราคารวมต่อหน่วยสั่ง ไม่เปลี่ยนราคาขายปกติ · ปล่อยว่างทั้งหมดถ้าไม่ใช้ราคาตามจำนวน")}</p>
        {rulesLockedBy ? (
          <PromotionRulesLockedNotice
            lockedBy={rulesLockedBy}
            rules={mechanicHasTiers ? tierForm.rules : []}
          />
        ) : (
          <PromotionQuantityRuleFields value={tierForm} onChange={setTierForm} compact />
        )}
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">
          {__uiText("ประเภทอาหาร")}</h3>
        <p className="mb-3 text-xs text-gray-500">
          {__uiText("เลือกประเภทอาหารของสินค้านี้ บันทึกแล้วจะแทนที่ชุดเดิมทั้งหมด")}</p>
        {cuisineOptions.length === 0 ? (
          <p className="text-xs text-gray-400">{__uiText("ไม่พบรายการประเภทอาหาร")}</p>
        ) : (
          <div className="max-h-64 space-y-3 overflow-y-auto">
            {cuisineOptions.map(({ parent, children }) => (
              <div key={parent.id}>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={selectedCuisineIds.includes(parent.id)}
                    onChange={() => toggleCuisine(parent.id)}
                  />
                  {parent.cuisine_name}
                </label>
                {children.length > 0 && (
                  <div className="mt-1 ml-5 grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {children.map((child) => (
                      <label
                        key={child.id}
                        className="flex items-center gap-2 text-xs text-gray-700"
                      >
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={selectedCuisineIds.includes(child.id)}
                          onChange={() => toggleCuisine(child.id)}
                        />
                        {child.cuisine_name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {selectedCuisineIds.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {__uiText("เลือกแล้ว ")}{selectedCuisineIds.length} {__uiText(" รายการ")}</p>
        )}
      </div>

      {contentOwned ? <div className="cp-card">
        <p>{commerceText('ชื่อ คำอธิบาย ส่วนประกอบ และสารก่อภูมิแพ้ ดูและแก้ไขได้ในงานเนื้อหาสินค้า', 'Inspect and edit names, descriptions, ingredients and allergens in the product content task.')}</p>
        <ButtonLink to={id ? ADMIN_ROUTES.productContent(id) : ADMIN_ROUTES.products} icon="edit_note">{commerceText('แก้ไขเนื้อหาสินค้า', 'Edit product content')}</ButtonLink>
      </div> : <>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">{__uiText("ภาษาไทย")}</h3>
        <Input
          label={__uiText("ชื่อสินค้า (ภาษาไทย) *")}
          value={form.product_name_th}
          onChange={(e) => handleInput('product_name_th', e.target.value)}
        />
        <Input
          label={__uiText("รายละเอียดสินค้า (ภาษาไทย)")}
          value={form.product_description_th}
          onChange={(e) => handleInput('product_description_th', e.target.value)}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">{__uiText("ภาษาอังกฤษ")}</h3>
        <Input
          label={__uiText("ชื่อสินค้า (ภาษาอังกฤษ) *")}
          value={form.product_name_en}
          onChange={(e) => handleInput('product_name_en', e.target.value)}
        />
        <Input
          label={__uiText("รายละเอียดสินค้า (ภาษาอังกฤษ)")}
          value={form.product_description_en}
          onChange={(e) => handleInput('product_description_en', e.target.value)}
        />
      </div>
      </>}

      <ProductDetailFormFields
        contentManagedSeparately={contentOwned}
        values={{
          ingredients: form.ingredients,
          allergens: form.allergens,
          expiration_info: form.expiration_info,
          storage_instruction: form.storage_instruction,
          usage_direction: form.usage_direction,
          expected_restock_at: form.expected_restock_at,
          nutrition_basis: form.nutrition_basis,
          nutrition_items: form.nutrition_items,
        }}
        onChange={(name, value) =>
          setForm((prev) => ({ ...prev, [name]: value }))
        }
      />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {__uiText("รูปภาพ (")}{totalImageCount}/{MAX_IMAGES})
        </h3>

        {activeExistingImages.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {activeExistingImages.map((item) => (
              <MediaCard
                key={item.product_media_id}
                label={__uiText("รูปที่ {0}", {"0": item.sort_order})}
                onRemove={() =>
                  setRemovedMediaIds((prev) => [...prev, item.product_media_id])
                }
              >
                <img
                  src={resolveMediaUrl(item.source)}
                  alt={__uiText("existing")}
                  className="w-full h-28 object-cover rounded-lg bg-gray-100"
                  onError={(event) => {
                    event.currentTarget.src =
                      'https://placehold.co/300x200?text=Image+Error';
                  }}
                />
              </MediaCard>
            ))}
          </div>
        )}

        {newImages.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {newImages.map((file, index) => (
              <MediaCard
                key={`${file.name}-${index}`}
                label={__uiText("รูปใหม่ {0}", {"0": index + 1})}
                onRemove={() =>
                  setNewImages((prev) => prev.filter((_, idx) => idx !== index))
                }
              >
                <img
                  src={URL.createObjectURL(file)}
                  alt={__uiText("new")}
                  className="w-full h-28 object-cover rounded-lg"
                />
              </MediaCard>
            ))}
          </div>
        )}

        {canAddImage && (
          <DragDropUpload
            onFileSelect={handleAddImage}
            accept="image/*"
            maxSizeMB={5}
          />
        )}
      </div>

      {!replacedLoading && replacedLogs.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <button
            type="button"
            onClick={() => setShowReplaced((prev) => !prev)}
            className="flex w-full items-center justify-between text-sm font-semibold text-gray-700"
          >
            <span>{__uiText("รูปก่อนหน้าที่สลับกลับได้ (")}{replacedLogs.length})</span>
            <span className="text-xs font-normal text-gray-400">{showReplaced ? __uiText("ซ่อน") : __uiText("แสดง")}</span>
          </button>

          {showReplaced && (
            <div className="mt-3 space-y-3">
              {replacedError && (
                <div className="rounded-lg bg-danger-container px-3 py-2 text-xs text-danger">
                  {(typeof (replacedError) === 'string' ? __uiText(replacedError) : replacedError)}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {replacedLogs.map((log) => (
                  <div key={log.logId} className="border rounded-xl p-3 bg-white">
                    <img
                      src={log.replacedUrl ?? undefined}
                      alt={__uiText("replaced")}
                      className="w-full h-28 object-cover rounded-lg bg-gray-100"
                      onError={(event) => {
                        event.currentTarget.src =
                          'https://placehold.co/300x200?text=Image+Error';
                      }}
                    />
                    <div className="mt-2 text-xs text-gray-500">
                      {__uiText("อัปโหลด")}{' '}
                      {new Date(log.createdAt).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </div>
                    <div className="mt-2 flex gap-3">
                      <button
                        type="button"
                        onClick={() => handleRestoreReplaced(log.logId)}
                        disabled={!!log.replacedDeletedAt || restoringLogId === log.logId}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                      >
                        {restoringLogId === log.logId ? __uiText("กำลังสลับ...") : __uiText("สลับไปใช้รูปนี้")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteReplaced(log.logId)}
                        disabled={deletingLogId === log.logId}
                        className="text-xs text-danger hover:underline disabled:opacity-50"
                      >
                        {deletingLogId === log.logId ? __uiText("กำลังลบ...") : __uiText("ลบรูปนี้ถาวร")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AdminInsertLayout>
  );
};

function MediaCard({
  label,
  children,
  onRemove,
}: {
  label: string;
  children: React.ReactNode;
  onRemove: () => void;
}) {
  __useUiLocale();
  return (
    <div className="border rounded-xl p-3 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-danger hover:underline"
        >
          {__uiText("ลบ")}</button>
      </div>
      {children}
    </div>
  );
}

export default EditProduct;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

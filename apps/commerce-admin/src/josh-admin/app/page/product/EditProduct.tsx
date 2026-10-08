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
import { DragDropUpload, Input } from '@josh/shared-ui-web';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  catalogOrderingPrice,
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
import { session } from '../../../../lib/api';
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
  parsePromotionRows,
  rulesToForm,
  validatePromotionMechanicForm,
  type PromotionMechanicForm,
} from '../campain/promotion-mechanic.helpers';

const MAX_IMAGES = 3;
const NUTRITION_FORM_KEYS = new Set(['nutrition_basis', 'nutrition_items']);

const EditProduct = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
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
    selling_unit_price: '',
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
  const [newBrandCode, setNewBrandCode] = useState('');
  // ERP PRICE (ราคากล่อง/หน่วยสั่ง) — read-only ที่นี่ เจ้าของค่าคือ ERP ไม่ใช่ admin
  const [orderingPrice, setOrderingPrice] = useState<string>('');

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

    Promise.all([
      getProductById(id, ADMIN_PRODUCT_READ),
      getProductCuisines(id),
      // Admin-only endpoint (the public detail must not carry a mechanic name). A failure leaves the
      // tiers editable — the backend still answers 400 to promotion_rules for a mechanic-owned SKU.
      getProductPromotionLock(id).catch(() => null),
    ])
      .then(([response, cuisines, lock]) => {
        const data = response.data;
        if (!data) return;

        const translations = data.translations ?? [];
        const th = getTranslation(translations, 'th');
        const en = getTranslation(translations, 'en');
        const nutrition = hydrateNutrition(data.nutrition);

        setForm({
          product_inventory_sku: data.product_inventory_sku ?? '',
          product_status: String(data.product_status ?? 1),
          product_inventory_quantity: String(data.product_inventory_quantity ?? ''),
          // The detail payload is priced like the shop (a promotion mechanic lowers
          // selling_unit_price, a customer/contract price nulls it) — base_selling_price
          // is always the catalog price, the only one an edit form may load and save back.
          selling_unit_price: String(catalogSellingPrice(data) ?? ''),
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
          Number(catalogSellingPrice(data) ?? 0),
          String(data.selling_unit ?? data.product_unit ?? 'ชิ้น'),
        );
        initialRulesRef.current = JSON.stringify(formToPromotionRules(loadedTierForm));
        setTierForm(loadedTierForm);
        setRulesLockedBy(lock);
        // The form's default row is not the mechanic's: only tiers the product response carries are.
        setMechanicHasTiers(parsePromotionRows(data.promotion_rules ?? data.tier_prices).length > 0);
        // ERP PRICE = the catalog box. `ordering_price` on the payload is priced like the shop
        // (a promotion / special price moves it); `base_ordering_price` is always the catalog one.
        const catalogOrdering = catalogOrderingPrice(data);
        setOrderingPrice(catalogOrdering == null ? '' : String(catalogOrdering));
        setExistingMedia(sortProductMedia(data.media ?? []));
        setSelectedCuisineIds(cuisines.map((row) => row.id));
      })
      .catch(() => {
        /* product load errors stay silent like before; cuisine defaults empty */
      })
      .finally(() => setLoading(false));
  }, [id]);

  const fetchReplacedLogs = () => {
    if (!id) return;
    getBulkUploadLogs({ productInventoryId: id, replacedOnly: true, limit: 100 })
      .then((response) => {
        const items: BulkUploadLogItem[] = response.data?.data?.items ?? [];
        // Rows already deleted server-side are just noise here.
        setReplacedLogs(items.filter((item) => !item.replacedDeletedAt));
      })
      .finally(() => setReplacedLoading(false));
  };

  useEffect(fetchReplacedLogs, [id]);

  // Refreshes only the gallery, not the whole product-loading effect above —
  // a full refetch would clobber any unsaved edits elsewhere in the form.
  const fetchExistingMedia = () => {
    if (!id) return;
    getProductById(id, ADMIN_PRODUCT_READ).then((response) => {
      if (response.data) setExistingMedia(sortProductMedia(response.data.media ?? []));
    });
  };

  const handleDeleteReplaced = async (logId: string) => {
    if (!window.confirm('ยืนยันลบรูปเก่าออกจาก S3? การลบนี้ไม่สามารถย้อนกลับได้')) return;
    setDeletingLogId(logId);
    setReplacedError(null);
    try {
      const response = await deleteBulkUploadReplacedImage(logId);
      if (response.data?.statusCode === 200) {
        setReplacedLogs((prev) => prev.filter((item) => item.logId !== logId));
      } else {
        setReplacedError(response.data?.message ?? 'ลบไม่สำเร็จ');
      }
    } catch (error: any) {
      setReplacedError(
        error?.response?.status === 409
          ? error.response.data?.message ?? 'รูปนี้ยังถูกใช้งานอยู่ ลบไม่ได้'
          : 'เกิดข้อผิดพลาดในการลบ',
      );
    } finally {
      setDeletingLogId(null);
    }
  };

  const handleRestoreReplaced = async (logId: string) => {
    if (!window.confirm('ยืนยันสลับไปใช้รูปนี้แทนรูปปัจจุบัน?')) return;
    setRestoringLogId(logId);
    setReplacedError(null);
    try {
      const response = await restoreBulkUploadReplacedImage(logId);
      if (response.data?.statusCode === 200) {
        fetchExistingMedia();
        fetchReplacedLogs();
      } else {
        setReplacedError(response.data?.message ?? 'สลับรูปไม่สำเร็จ');
      }
    } catch (error: any) {
      setReplacedError(error?.response?.data?.message ?? 'เกิดข้อผิดพลาดในการสลับรูป');
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
      alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
      return;
    }
    if (!canAddImage) {
      alert(`อัปโหลดรูปภาพได้สูงสุด ${MAX_IMAGES} รูป`);
      return;
    }
    setNewImages((prev) => [...prev, file]);
  };

  const handleSubmit = async () => {
    if (!id) return;
    if (!form.product_inventory_sku || !form.product_name_th || !form.product_name_en) {
      alert('กรุณากรอก SKU และชื่อสินค้าทั้ง 2 ภาษา');
      return;
    }

    const graphic = session.claims()?.role === 'graphic';
    if (!graphic && !form.selling_unit_price.trim()) {
      alert('กรุณาระบุราคาขาย');
      return;
    }

    if (totalImageCount > MAX_IMAGES) {
      alert(`รูปภาพได้สูงสุด ${MAX_IMAGES} รูป`);
      return;
    }

    const tierError = graphic || rulesLockedBy ? null : validatePromotionMechanicForm(tierForm);
    if (tierError) {
      alert(tierError);
      return;
    }

    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (NUTRITION_FORM_KEYS.has(key)) return;
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
            alert('บันทึกสินค้าแล้ว แต่บันทึก cuisine ไม่สำเร็จ — ลองบันทึกอีกครั้ง');
            return;
          }
        }
        navigate(ADMIN_ROUTES.productDetail(id));
        return;
      }
      alert(response.data?.message ?? 'บันทึกไม่สำเร็จ');
    } catch (err) {
      // e.g. 400 promotion_rules_locked_by_mechanic — the message names the mechanic
      alert(saveErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึก'));
    } finally {
      setSaving(false);
    }
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

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
  }

  return (
    <AdminInsertLayout
      title="แก้ไขสินค้า"
      subtitle="อัปเดตข้อมูลและรูปภาพ (สูงสุด 3 รูป) — วิดีโอให้ใช้หน้า Upload Video"
      backPath={id ? ADMIN_ROUTES.productDetail(id) : ADMIN_ROUTES.products}
      saving={saving}
      onSave={handleSubmit}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="รหัสสินค้า (SKU) *"
          hint="มาจาก ERP — แก้ที่นี่ไม่ได้"
          value={form.product_inventory_sku}
          disabled
          readOnly
        />
        <Input
          label="สถานะสินค้า"
          hint="1 = ใช้งาน, 0 = ปิด"
          value={form.product_status}
          onChange={(e) => handleInput('product_status', e.target.value)}
        />
        <Input
          label="จำนวนสต็อก"
          value={form.product_inventory_quantity}
          onChange={(e) => handleInput('product_inventory_quantity', e.target.value)}
        />
        <Input
          label="ชื่อแบรนด์"
          value={form.brand_name}
          onChange={(e) => handleInput('brand_name', e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">แบรนด์</label>
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={form.brand_code}
            onChange={(e) => handleInput('brand_code', e.target.value)}
          >
            <option value="">-- เลือกแบรนด์ --</option>
            {brandOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Input
            label="หรือพิมพ์รหัสแบรนด์ใหม่ (ถ้ายังไม่มีในลิสต์)"
            value={newBrandCode}
            onChange={(e: any) => {
              setNewBrandCode(e.target.value);
              handleInput('brand_code', e.target.value || form.brand_code);
            }}
            placeholder="เช่น ACME"
          />
        </div>
        <Input
          label="ผู้ผลิต/บรรจุ (Marketed By)"
          value={form.marketed_by}
          onChange={(e) => handleInput('marketed_by', e.target.value)}
        />
        <Input
          label="ประเภทภาษีมูลค่าเพิ่ม (VAT Type)"
          hint="0% หรือ 7%"
          value={form.vat_type}
          onChange={(e) => handleInput('vat_type', e.target.value)}
        />
        <Input
          label="อุณหภูมิเก็บรักษา"
          value={form.storage_temperature}
          onChange={(e) => handleInput('storage_temperature', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="ราคาต่อหน่วยขาย (฿) *"
          hint="เรทต่อหน่วยขาย (ERP SELLING_UNIT_PRICE) ไม่ใช่ราคากล่องที่ลูกค้าจ่าย"
          type="number"
          value={form.selling_unit_price}
          onChange={(e) => handleInput('selling_unit_price', e.target.value)}
        />
        <Input
          label="ราคากล่อง / หน่วยสั่ง (฿)"
          hint={
            orderingPrice
              ? 'ERP PRICE — ราคาที่ลูกค้าจ่ายจริง แก้ที่ ERP เท่านั้น'
              : 'ยังไม่มีค่าจาก ERP และคำนวณจาก pack ไม่ได้'
          }
          value={orderingPrice}
          disabled
        />
        <Input
          label="หน่วยขาย"
          value={form.selling_unit}
          onChange={(e) => handleInput('selling_unit', e.target.value)}
          placeholder="เช่น ชิ้น"
        />
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">
          ราคาตามจำนวนซื้อ (Tier)
        </h3>
        <p className="mb-3 text-xs text-gray-500">
          ขั้นต่ำ qty ต้องไม่ทับซ้อน — เป็นราคาโปรระดับสินค้า ไม่เปลี่ยนราคาขายฐาน (แก้ราคาฐานที่ช่อง “ราคาต่อหน่วยขาย”)
        </p>
        {rulesLockedBy ? (
          <PromotionRulesLockedNotice
            lockedBy={rulesLockedBy}
            rules={mechanicHasTiers ? tierForm.rules : []}
          />
        ) : (
          <PromotionQuantityRuleFields value={tierForm} onChange={setTierForm} />
        )}
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">
          Cuisine (Shop by Cuisine)
        </h3>
        <p className="mb-3 text-xs text-gray-500">
          เลือก taxonomy ที่ SKU นี้อยู่ — บันทึกแล้วจะแทนที่ชุดเดิมทั้งหมด (replace)
        </p>
        {cuisineOptions.length === 0 ? (
          <p className="text-xs text-gray-400">ไม่พบรายการ cuisine</p>
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
            เลือกแล้ว {selectedCuisineIds.length} รายการ
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">ภาษาไทย</h3>
        <Input
          label="ชื่อสินค้า (ภาษาไทย) *"
          value={form.product_name_th}
          onChange={(e) => handleInput('product_name_th', e.target.value)}
        />
        <Input
          label="รายละเอียดสินค้า (ภาษาไทย)"
          value={form.product_description_th}
          onChange={(e) => handleInput('product_description_th', e.target.value)}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">ภาษาอังกฤษ</h3>
        <Input
          label="ชื่อสินค้า (ภาษาอังกฤษ) *"
          value={form.product_name_en}
          onChange={(e) => handleInput('product_name_en', e.target.value)}
        />
        <Input
          label="รายละเอียดสินค้า (ภาษาอังกฤษ)"
          value={form.product_description_en}
          onChange={(e) => handleInput('product_description_en', e.target.value)}
        />
      </div>

      <ProductDetailFormFields
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
          รูปภาพ ({totalImageCount}/{MAX_IMAGES})
        </h3>

        {activeExistingImages.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {activeExistingImages.map((item) => (
              <MediaCard
                key={item.product_media_id}
                label={`รูปที่ ${item.sort_order}`}
                onRemove={() =>
                  setRemovedMediaIds((prev) => [...prev, item.product_media_id])
                }
              >
                <img
                  src={resolveMediaUrl(item.source)}
                  alt="existing"
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
                label={`รูปใหม่ ${index + 1}`}
                onRemove={() =>
                  setNewImages((prev) => prev.filter((_, idx) => idx !== index))
                }
              >
                <img
                  src={URL.createObjectURL(file)}
                  alt="new"
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
            <span>รูปก่อนหน้าที่สลับกลับได้ ({replacedLogs.length})</span>
            <span className="text-xs font-normal text-gray-400">{showReplaced ? 'ซ่อน' : 'แสดง'}</span>
          </button>

          {showReplaced && (
            <div className="mt-3 space-y-3">
              {replacedError && (
                <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {replacedError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {replacedLogs.map((log) => (
                  <div key={log.logId} className="border rounded-xl p-3 bg-white">
                    <img
                      src={log.replacedUrl ?? undefined}
                      alt="replaced"
                      className="w-full h-28 object-cover rounded-lg bg-gray-100"
                      onError={(event) => {
                        event.currentTarget.src =
                          'https://placehold.co/300x200?text=Image+Error';
                      }}
                    />
                    <div className="mt-2 text-xs text-gray-500">
                      อัปโหลด{' '}
                      {new Date(log.createdAt).toLocaleString('th-TH', {
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
                        {restoringLogId === log.logId ? 'กำลังสลับ...' : 'สลับไปใช้รูปนี้'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteReplaced(log.logId)}
                        disabled={deletingLogId === log.logId}
                        className="text-xs text-red-500 hover:underline disabled:opacity-50"
                      >
                        {deletingLogId === log.logId ? 'กำลังลบ...' : 'ลบออกจาก S3'}
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
  return (
    <div className="border rounded-xl p-3 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-red-500 hover:underline"
        >
          ลบ
        </button>
      </div>
      {children}
    </div>
  );
}

export default EditProduct;

import { createProduct, getBrands } from '@josh/shared-api';
import {
  Input,
  DateRangeInput,
  DragDropUpload,
  Button,
} from '@josh/shared-ui-web';
import { saveErrorMessage } from './catalog-price';
import React, { useEffect, useState } from 'react';
import {
  buildNutritionPayload,
  EMPTY_NUTRITION_ROW,
} from './product-nutrition.helpers';
import ProductDetailFormFields, {
  type ProductDetailFormValues,
} from './ProductDetailFormFields';
import PromotionQuantityRuleFields from '../campain/PromotionQuantityRuleFields';
import {
  EMPTY_PROMOTION_MECHANIC_FORM,
  formToPromotionRules,
  validatePromotionMechanicForm,
  type PromotionMechanicForm,
} from '../campain/promotion-mechanic.helpers';
import { categoryOption, createCategoryOption, leafCategories, useCategoryRows } from '../category/category-form';
import { roleCanWrite } from '../../../../app/role-can';
// 🌟 สมมติพิกัด Import ของ Components กลางในโปรเจกต์ของคุณ
// import { Button, Input, DragDropUpload, DateRangeInput } from '@/components/common';

// ui-copy-migration: only literal UI copy and notification templates
import { ButtonLink, MasterDataSelect, PageHeader, toast, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export default function InsertProductForm() {
  __useUiLocale();
  const categoryRows = useCategoryRows();
  // 1. สเตตสำหรับข้อมูลข้อความทั่วไป (Global & Translations)
  const [formData, setFormData] = useState({
    product_sku: '',
    category_id: '',
    storage_temperature: 'Ambient',
    is_organic: '0',
    product_status: '1',
    product_name_th: '',
    product_description_th: '',
    product_name_en: '',
    product_description_en: '',
    brand_code: '',
  });

  const [brandOptions, setBrandOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    getBrands()
      .then((response: any) => {
        const rows = response?.data?.data ?? [];
        setBrandOptions(
          rows.map((b: any) => ({
            value: b.brand_code,
            label: `${b.brand_name_th || b.brand_name_en || 'ยังไม่มีชื่อ'}${b.brand_code ? ` (${b.brand_code})` : ''}`,
          })),
        );
      })
      .catch(() => setBrandOptions([]));
  }, []);

  // 2. 📸 สเตตคลังเก็บรูปภาพจริง (รอบนี้ทำเป็นอาเรย์รองรับได้สูงสุด 3 รูป)
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  // 3. สเตตสำหรับระยะเวลา (ถ้าตารางสินค้าของคุณมีฟีลด์แคมเปญ/จัดโปรโมชั่น หรือ Best Before)
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [sellingPrice, setSellingPrice] = useState('');
  const [sellingUnit, setSellingUnit] = useState('ชิ้น');
  const [stockQty, setStockQty] = useState('');
  const [tierForm, setTierForm] = useState<PromotionMechanicForm>({
    ...EMPTY_PROMOTION_MECHANIC_FORM,
    rules: [...EMPTY_PROMOTION_MECHANIC_FORM.rules],
  });
  const [detailForm, setDetailForm] = useState<ProductDetailFormValues>({
    ingredients: '',
    allergens: '',
    expiration_info: '',
    storage_instruction: '',
    usage_direction: '',
    expected_restock_at: '',
    nutrition_basis: '',
    nutrition_items: [{ ...EMPTY_NUTRITION_ROW }],
  });

  const handleInputChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // 📸 ฟังก์ชันสะสมรูปภาพเมื่อผู้ใช้ลากวางไฟล์ (เก็บได้สูงสุด 3 รูป)
  const handleFileSelect = (file: File | null) => {
    if (!file) return;
    setUploadedFiles((prev) => {
      if (prev.length >= 3) {
        alert(__uiText("อัปโหลดรูปภาพได้สูงสุด 3 รูปเท่านั้นครับ!"));
        return prev;
      }
      return [...prev, file];
    });
  };

  // ฟังก์ชันลบรูปภาพออกจากคิว (กรณีแอดมินเลือกรูปผิดชิ้น)
  const removeFile = (indexToRemove: number) => {
    setUploadedFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // 🚀 ฟังก์ชันซับมิทส่งก้อนข้อมูลแบบ FormData ไปหลังบ้าน
  const handleSubmit = async () => {
    // เช็กความเหนียวของสเปกสินค้าเบื้องต้น
    const missing: string[] = [];
    if (!formData.product_sku.trim()) missing.push(__uiText('รหัสสินค้า เช่น BREAD-001'));
    if (!formData.product_name_th.trim()) missing.push(__uiText('ชื่อภาษาไทยที่ลูกค้าเห็น'));
    if (!formData.product_name_en.trim()) missing.push(__uiText('ชื่อภาษาอังกฤษ'));
    if (!sellingPrice.trim()) missing.push(__uiText('ราคาขายเป็นตัวเลข เช่น 45'));
    if (missing.length) {
      alert(__uiText('ยังบันทึกสินค้าไม่ได้ กรอกให้ครบ: {0}', { 0: missing.join(' · ') }));
      return;
    }

    const data = new FormData();

    data.append('product_inventory_sku', formData.product_sku);
    data.append('product_sku', formData.product_sku);
    Object.keys(formData).forEach((key) => {
      if (key === 'product_sku') return;
      data.append(key, (formData as Record<string, string>)[key]);
    });

    data.append('selling_price', sellingPrice.trim());
    data.append('selling_unit', sellingUnit.trim() || 'ชิ้น');
    if (stockQty.trim()) {
      data.append('product_inventory_quantity', stockQty.trim());
    }
    if (startDate) data.append('start_date', startDate.toISOString());
    if (endDate) data.append('end_date', endDate.toISOString());

    data.append('ingredients', detailForm.ingredients);
    data.append('allergens', detailForm.allergens);
    data.append('expiration_info', detailForm.expiration_info);
    data.append('storage_instruction', detailForm.storage_instruction);
    data.append('usage_direction', detailForm.usage_direction);
    if (detailForm.expected_restock_at) {
      data.append('expected_restock_at', detailForm.expected_restock_at);
    }
    data.append(
      'nutrition',
      JSON.stringify(
        buildNutritionPayload(detailForm.nutrition_basis, detailForm.nutrition_items),
      ),
    );

    const tierError = validatePromotionMechanicForm(tierForm);
    if (tierError) {
      alert(tierError);
      return;
    }
    data.append(
      'promotion_rules',
      JSON.stringify(formToPromotionRules(tierForm)),
    );

    // 3. 🎯 ช็อตเด็ด: วนลูปยัดไฟล์ภาพจริงทั้งสามรูปเข้าท่อชื่อ 'images' ให้ตรงใจตัวตกแต่งฝั่งเนสท์
    uploadedFiles.forEach((file) => {
      data.append('images', file);
    });

    try {
      const response = await createProduct(data);
      const result = response.data as { product_inventory_id?: string; product_inventory_sku?: string; message?: string };

      if (result?.product_inventory_id) {
        toast(
          __uiText('บันทึกสินค้าแล้ว'),
          { label: __uiText('ขั้นถัดไป: เปิดดูสินค้าในรายการ'), href: '/j/allproducts' },
        );
        // ตั้งค่าเคลียร์ฟอร์มตามใจชอบหลังจากทำรายการสำเร็จ
      } else {
        alert(__uiText("❌ เกิดข้อผิดพลาดจากระบบหลังบ้าน: {0}", {"0": result.message}));
      }
    } catch (error) {
      console.error('Submit Product Form Failed:', error);
      alert(__uiText("❌ สร้างสินค้าไม่สำเร็จ: {0}", {"0": saveErrorMessage(error, 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์หลังบ้านได้ในขณะนี้')}));
    }
  };

  return (
    <div className="cp-page-panel space-y-6 border border-gray-200 bg-white rounded-xl p-4 md:p-6">
        <PageHeader back={{ to: '/j/allproducts', label: 'กลับรายการสินค้า' }} title={__uiText('เพิ่มสินค้า')} subtitle={__uiText('กรอกชื่อที่ลูกค้าเห็น ราคา และหมวด แล้วบันทึก')} />

        {/* 📌 ส่วนที่ 1: ข้อมูลหลักสินค้า (ใช้ Component กลาง <Input />) */}
        <div className="space-y-4">
          <h3 className="text-[15px] font-semibold text-on-surface">
            {__uiText('1. ข้อมูลสินค้า')}</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Input
                label={__uiText("รหัสสินค้า")}
                required
                hint={__uiText("รหัสสั้นที่ใช้ค้นในระบบ เช่น BREAD-001 ลูกค้าเห็นชื่อสินค้า ไม่ใช่รหัสนี้")}
                value={formData.product_sku}
                onChange={(e: any) =>
                  handleInputChange('product_sku', e.target.value)
                }
                placeholder={__uiText("BREAD-001")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                <span className="mb-1 block">{__uiText("หมวดหมู่สินค้า")}</span>
                <MasterDataSelect
                  options={leafCategories(categoryRows).map(categoryOption)}
                  value={formData.category_id}
                  onChange={(next) => handleInputChange('category_id', String(next))}
                  canCreate={roleCanWrite(['merchandising'])}
                  createFrom="category_name_en"
                  createFields={[
                    { name: 'category_name_en', label: 'ชื่อภาษาอังกฤษ', required: true, placeholder: 'Bakery' },
                    { name: 'parent_id', label: 'หมวดที่อยู่เหนือกว่า', options: categoryRows.map(categoryOption) },
                  ]}
                  onCreate={(draft) => createCategoryOption(draft)}
                />
              </label>
              <p className="mt-1 text-xs text-gray-500">
                {__uiText("เห็นเฉพาะหมวดปลายกิ่ง — สินค้าผูกกับหมวดที่ไม่มีหมวดย่อยเสมอ (พิมพ์ชื่อขณะเปิดลิสต์เพื่อค้นหาได้)")}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{__uiText("แบรนด์")}</label>
              <MasterDataSelect
                aria-label={__uiText("แบรนด์")}
                options={[{ value: '', label: __uiText("ไม่ระบุแบรนด์") }, ...brandOptions]}
                value={formData.brand_code}
                onChange={(next) => handleInputChange('brand_code', String(next))}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Input
              label={__uiText("ราคาขาย / หน่วยสั่ง (฿)")}
              required
              hint={__uiText("ราคาต่อหน่วยที่ลูกค้าจ่าย เช่น 45")}
              type="number"
              min={0}
              step="0.01"
              value={sellingPrice}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSellingPrice(e.target.value)
              }
              placeholder={__uiText("เช่น 100")}
            />
          </div>
          <div>
            <Input
              label={__uiText("หน่วยขาย")}
              hint={__uiText("หน่วยที่ลูกค้าสั่ง เช่น ชิ้น แพ็ก หรือกิโลกรัม")}
              value={sellingUnit}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSellingUnit(e.target.value)
              }
              placeholder={__uiText("เช่น ชิ้น")}
            />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          {__uiText("ราคาตามจำนวน (เช่น ซื้อ 5 ชิ้นลด) ตั้งที่หน้าโปรโมชัน")}</p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Input
              label={__uiText("จำนวนในคลังเริ่มต้น")}
              hint={__uiText("ไม่บังคับ ใส่ 0 ถ้ายังไม่รับสินค้าเข้า")}
              type="number"
              value={stockQty}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setStockQty(e.target.value)
              }
              placeholder="0"
            />
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-800">
            {__uiText("ราคาตามจำนวนซื้อ")}</h3>
          <PromotionQuantityRuleFields value={tierForm} onChange={setTierForm} compact />
        </div>

        </div>

        {/* 🇹🇭 ส่วนที่ 2: ข้อมูลภาษาไทย (Thai Translation) */}
        <div className="space-y-4">
          <h3 className="text-[15px] font-semibold text-on-surface">
            {__uiText('2. ชื่อและคำอธิบายภาษาไทย')}</h3>
          <Input
            label={__uiText("ชื่อสินค้าภาษาไทย")}
            required
            hint={__uiText("ชื่อที่ลูกค้าภาษาไทยเห็นบนร้าน")}
            placeholder={__uiText("ขนมปังโฮลวีต")}
            value={formData.product_name_th}
            onChange={(e: any) =>
              handleInputChange('product_name_th', e.target.value)
            }
          />
          <Input
            label={__uiText("คำอธิบายภาษาไทย")}
            hint={__uiText("ไม่บังคับ สั้น ๆ หนึ่งถึงสองประโยค")}
            placeholder={__uiText("ขนมปังโฮลวีต 450 กรัม")}
            value={formData.product_description_th}
            onChange={(e: any) =>
              handleInputChange('product_description_th', e.target.value)
            }
          />
        </div>

        {/* 🇺🇸 ส่วนที่ 3: ข้อมูลภาษาอังกฤษ (English Translation) */}
        <div className="space-y-4">
          <h3 className="text-[15px] font-semibold text-on-surface">
            {__uiText('3. ชื่อและคำอธิบายภาษาอังกฤษ')}</h3>
          <Input
            label={__uiText("ชื่อสินค้าภาษาอังกฤษ")}
            required
            hint={__uiText("ชื่อที่ลูกค้าภาษาอังกฤษเห็น")}
            placeholder="Whole wheat bread"
            value={formData.product_name_en}
            onChange={(e: any) =>
              handleInputChange('product_name_en', e.target.value)
            }
          />
          <Input
            label={__uiText("คำอธิบายภาษาอังกฤษ")}
            hint={__uiText("ไม่บังคับ")}
            placeholder="Whole wheat loaf, 450 g"
            value={formData.product_description_en}
            onChange={(e: any) =>
              handleInputChange('product_description_en', e.target.value)
            }
          />
        </div>

        <ProductDetailFormFields
          values={detailForm}
          onChange={(name, value) =>
            setDetailForm((prev) => ({ ...prev, [name]: value }))
          }
        />

        {/* 📸 ส่วนที่ 4: ลากวางอัปโหลดไฟล์จริง (Component กลาง <DragDropUpload />) */}
        <div className="space-y-4">
          <h3 className="text-[15px] font-semibold text-on-surface">
            {__uiText('4. รูปสินค้า สูงสุด 3 รูป')}</h3>

          {/* เสียบตัวลากวางส่วนกลางของคุณที่นี่ */}
          <DragDropUpload
            onFileSelect={handleFileSelect}
            accept="image/*"
            maxSizeMB={2}
          />

          {/* 🖼️ แผงโชว์รูปภาพพรีวิวที่เลือกเข้ามาแล้ว */}
          {uploadedFiles.length > 0 && (
            <div className="grid grid-cols-3 gap-4 pt-2">
              {uploadedFiles.map((file, index) => (
                <div
                  key={index}
                  className="relative group border rounded-lg p-2 bg-gray-50 flex flex-col items-center"
                >
                  <img
                    src={URL.createObjectURL(file)}
                    alt={__uiText("preview-{0}", {"0": index})}
                    className="h-24 w-24 object-cover rounded-md shadow-inner"
                  />
                  <span className="text-xs text-gray-500 mt-1 truncate max-w-full px-1">
                    {file.name}
                  </span>
                  <span className="absolute top-1 right-1 bg-primary text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow">
                    {__uiText("รูปที่ ")}{index + 1} {index === 0 && '⭐'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="mt-2 text-xs text-danger font-semibold hover:underline"
                  >
                    {__uiText("ลบรูปนี้")}</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 🚀 ปุ่มกดบันทึกโดยใช้ Component กลาง <Button /> ของคุณ */}
        <div className="flex flex-wrap items-center gap-2 pt-4">
          <Button
            text={__uiText("บันทึกสินค้า")}
            onClick={() => handleSubmit()}
          />
          <ButtonLink to="/j/allproducts" variant="secondary">{__uiText("ยกเลิก")}</ButtonLink>
        </div>
    </div>
  );
}

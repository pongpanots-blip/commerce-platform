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
import { LeafCategorySelect, useCategoryRows } from '../category/category-form';
// 🌟 สมมติพิกัด Import ของ Components กลางในโปรเจกต์ของคุณ
// import { Button, Input, DragDropUpload, DateRangeInput } from '@/components/common';

export default function InsertProductForm() {
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
  const [newBrandCode, setNewBrandCode] = useState('');

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
        alert('อัปโหลดรูปภาพได้สูงสุด 3 รูปเท่านั้นครับ!');
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
    if (
      !formData.product_sku ||
      !formData.product_name_th ||
      !formData.product_name_en ||
      !sellingPrice.trim()
    ) {
      alert(
        'กรุณากรอกข้อมูลที่จำเป็น (* SKU, ชื่อสินค้าทั้ง 2 ภาษา และราคาขาย) ให้ครบถ้วนครับ',
      );
      return;
    }

    const data = new FormData();

    data.append('product_inventory_sku', formData.product_sku);
    data.append('product_sku', formData.product_sku);
    Object.keys(formData).forEach((key) => {
      if (key === 'product_sku') return;
      data.append(key, (formData as Record<string, string>)[key]);
    });

    data.append('selling_unit_price', sellingPrice.trim());
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
        alert(
          `🎉 สร้างสินค้าใหม่และอัปโหลดรูปภาพสำเร็จ! SKU ${result.product_inventory_sku ?? formData.product_sku} · ID: ${result.product_inventory_id}`,
        );
        // ตั้งค่าเคลียร์ฟอร์มตามใจชอบหลังจากทำรายการสำเร็จ
      } else {
        alert(`❌ เกิดข้อผิดพลาดจากระบบหลังบ้าน: ${result.message}`);
      }
    } catch (error) {
      console.error('Submit Product Form Failed:', error);
      alert(`❌ สร้างสินค้าไม่สำเร็จ: ${saveErrorMessage(error, 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์หลังบ้านได้ในขณะนี้')}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-gray-50 min-h-screen">
      <div className="space-y-6 bg-white p-8 rounded-xl shadow-sm border border-gray-200">
        <h2 className="text-2xl font-bold text-gray-800 border-b pb-4">
          ✨ เพิ่มสินค้าใหม่พร้อมระบบอัปโหลดคลังภาพ 3 มิติ
        </h2>

        {/* 📌 ส่วนที่ 1: ข้อมูลหลักสินค้า (ใช้ Component กลาง <Input />) */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">
            📦 1. ข้อมูลหลักสินค้า (Global Info)
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input
                label="รหัสสินค้า (SKU) *"
                value={formData.product_sku}
                onChange={(e: any) =>
                  handleInputChange('product_sku', e.target.value)
                }
                placeholder="เช่น BIDBEK666640977"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                <span className="mb-1 block">หมวดหมู่สินค้า</span>
                <LeafCategorySelect
                  rows={categoryRows}
                  value={formData.category_id}
                  onChange={(categoryId) => handleInputChange('category_id', categoryId)}
                />
              </label>
              <p className="mt-1 text-xs text-gray-500">
                เห็นเฉพาะหมวดปลายกิ่ง — สินค้าผูกกับหมวดที่ไม่มีหมวดย่อยเสมอ
                (พิมพ์ชื่อขณะเปิดลิสต์เพื่อค้นหาได้)
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">แบรนด์</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={formData.brand_code}
                onChange={(e) => handleInputChange('brand_code', e.target.value)}
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
                  handleInputChange('brand_code', e.target.value || formData.brand_code);
                }}
                placeholder="เช่น ACME"
              />
            </div>
          </div>
        </div>

        <hr />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Input
              label="ราคาขาย (฿) *"
              type="number"
              min={0}
              step="0.01"
              value={sellingPrice}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSellingPrice(e.target.value)
              }
              placeholder="เช่น 100"
            />
          </div>
          <div>
            <Input
              label="หน่วยขาย"
              value={sellingUnit}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSellingUnit(e.target.value)
              }
              placeholder="เช่น ชิ้น"
            />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          ราคาตามจำนวน (ซื้อ 5 ชิ้นลด) ตั้งที่เมนู Promotion Mechanic
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Input
              label="จำนวนสต็อกเริ่มต้น"
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
            ราคาตามจำนวนซื้อ (Tier)
          </h3>
          <PromotionQuantityRuleFields value={tierForm} onChange={setTierForm} />
        </div>

        <hr />

        {/* 🇹🇭 ส่วนที่ 2: ข้อมูลภาษาไทย (Thai Translation) */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-red-600">
            🇹🇭 2. ข้อมูลภาษาไทย (Thai Translation)
          </h3>
          <Input
            label="ชื่อสินค้า (ภาษาไทย) *"
            value={formData.product_name_th}
            onChange={(e: any) =>
              handleInputChange('product_name_th', e.target.value)
            }
          />
          <Input
            label="รายละเอียดสินค้าอย่างย่อ (ภาษาไทย)"
            value={formData.product_description_th}
            onChange={(e: any) =>
              handleInputChange('product_description_th', e.target.value)
            }
          />
        </div>

        <hr />

        {/* 🇺🇸 ส่วนที่ 3: ข้อมูลภาษาอังกฤษ (English Translation) */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">
            🇺🇸 3. ข้อมูลภาษาอังกฤษ (English Translation)
          </h3>
          <Input
            label="ชื่อสินค้า (ภาษาอังกฤษ) *"
            value={formData.product_name_en}
            onChange={(e: any) =>
              handleInputChange('product_name_en', e.target.value)
            }
          />
          <Input
            label="รายละเอียดสินค้าอย่างย่อ (ภาษาอังกฤษ)"
            value={formData.product_description_en}
            onChange={(e: any) =>
              handleInputChange('product_description_en', e.target.value)
            }
          />
        </div>

        <hr />

        <ProductDetailFormFields
          values={detailForm}
          onChange={(name, value) =>
            setDetailForm((prev) => ({ ...prev, [name]: value }))
          }
        />

        <hr />

        {/* 📸 ส่วนที่ 4: ลากวางอัปโหลดไฟล์จริง (Component กลาง <DragDropUpload />) */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-green-600">
            📸 4. คลังรูปภาพสินค้า (อัปโหลดสูงสุด 3 รูป)
          </h3>

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
                    alt={`preview-${index}`}
                    className="h-24 w-24 object-cover rounded-md shadow-inner"
                  />
                  <span className="text-xs text-gray-500 mt-1 truncate max-w-full px-1">
                    {file.name}
                  </span>
                  <span className="absolute top-1 right-1 bg-primary text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow">
                    รูปที่ {index + 1} {index === 0 && '⭐'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="mt-2 text-xs text-red-500 font-semibold hover:text-red-700 hover:underline"
                  >
                    🛑 ลบรูปนี้
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 🚀 ปุ่มกดบันทึกโดยใช้ Component กลาง <Button /> ของคุณ */}
        <div className="pt-4">
          <Button
            text="💾 บันทึกข้อมูลและประมวลผล AI"
            onClick={() => handleSubmit()}
          />
        </div>
      </div>
    </div>
  );
}

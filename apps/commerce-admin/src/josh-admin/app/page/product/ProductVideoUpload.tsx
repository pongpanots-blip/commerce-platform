import { getProducts, uploadProductVideo } from '@josh/shared-api';
import { ADMIN_PRODUCT_READ } from '../../config/admin-product-read';
import { Button, DragDropUpload, Input } from '@josh/shared-ui-web';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AiOutlineSearch } from 'react-icons/ai';
import { MdOutlineDelete } from 'react-icons/md';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type ProductRow = {
  product_inventory_id: string;
  product_inventory_sku: string;
  product_name?: string;
};

const ProductVideoUpload = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ProductRow[]>([]);
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [manualSku, setManualSku] = useState('');

  const selectedSkuSet = useMemo(() => new Set(selectedSkus), [selectedSkus]);
  const searchInputId = React.useId();

  const loadProducts = async (term: string) => {
    try {
      const response = await getProducts(1, 20, term, ADMIN_PRODUCT_READ);
      if (response?.status === 200) {
        setSearchResults(response.data?.data ?? []);
      }
    } catch {
      setSearchResults([]);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadProducts(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const toggleSku = (sku: string) => {
    setSelectedSkus((prev) =>
      prev.includes(sku) ? prev.filter((item) => item !== sku) : [...prev, sku],
    );
  };

  const addManualSku = () => {
    const sku = manualSku.trim();
    if (!sku) return;
    if (!selectedSkuSet.has(sku)) {
      setSelectedSkus((prev) => [...prev, sku]);
    }
    setManualSku('');
  };

  const handleSubmit = async () => {
    if (!videoFile) {
      alert(__uiText("กรุณาอัปโหลดวิดีโอ"));
      return;
    }
    if (selectedSkus.length === 0) {
      alert(__uiText("กรุณาเลือก SKU อย่างน้อย 1 รายการ"));
      return;
    }

    const payload = new FormData();
    payload.append('video', videoFile);
    payload.append('skus', JSON.stringify(selectedSkus));

    setSaving(true);
    try {
      const response = await uploadProductVideo(payload);
      const result = response.data;
      if (result?.statusCode === 200) {
        const notFound = (result.not_found_skus as string[] | undefined) ?? [];
        const message = notFound.length
          ? `อัปโหลดสำเร็จ ${result.updated_skus?.length ?? 0} SKU\nไม่พบ SKU: ${notFound.join(', ')}`
          : `อัปโหลดวิดีโอสำเร็จ ${result.updated_skus?.length ?? 0} SKU`;
        alert(message);
        navigate(ADMIN_ROUTES.products);
        return;
      }
      alert(result?.message ?? __uiText("อัปโหลดไม่สำเร็จ"));
    } catch {
      alert(__uiText("เกิดข้อผิดพลาดในการอัปโหลดวิดีโอ"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title={__uiText("อัปโหลดวิดีโอสินค้า")}
      subtitle={__uiText("เลือก SKU ที่ต้องการให้วิดีโอนี้ไปแสดง (วิดีโอจะอยู่ลำดับสุดท้ายเสมอ)")}
      backPath={ADMIN_ROUTES.products}
      saving={saving}
      onSave={handleSubmit}
    >
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">{__uiText("1. เลือกวิดีโอ")}</h3>
        {videoFile ? (
          <div className="border rounded-xl p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-600">{videoFile.name}</span>
              <button
                type="button"
                onClick={() => setVideoFile(null)}
                className="text-xs text-red-500 hover:underline"
              >
                {__uiText("ลบ")}</button>
            </div>
            <video
              src={URL.createObjectURL(videoFile)}
              controls
              className="w-full h-48 object-cover rounded-lg bg-black"
            />
          </div>
        ) : (
          <DragDropUpload
            onFileSelect={(file) => {
              if (!file.type.startsWith('video/')) {
                alert(__uiText("กรุณาเลือกไฟล์วิดีโอเท่านั้น"));
                return;
              }
              setVideoFile(file);
            }}
            accept="video/*"
            maxSizeMB={50}
          />
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">{__uiText("2. เลือก SKU เป้าหมาย")}</h3>
        <div className="flex items-end gap-2">
          <Input
            label={__uiText("เพิ่มรหัสสินค้า (SKU) ด้วยตนเอง")}
            value={manualSku}
            onChange={(e) => setManualSku(e.target.value)}
            placeholder={__uiText("พิมพ์ SKU แล้วกดเพิ่ม")}
          />
          <Button text={__uiText("เพิ่ม SKU")} onClick={addManualSku} />
        </div>

        {selectedSkus.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedSkus.map((sku) => (
              <span
                key={sku}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
              >
                {sku}
                <button type="button" onClick={() => toggleSku(sku)}>
                  <MdOutlineDelete size={14} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div>
          <label htmlFor={searchInputId} className="mb-1 block text-sm text-gray-600">
            {__uiText("ค้นหาสินค้า")}</label>
          <div className="relative">
            <AiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              id={searchInputId}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={__uiText("ค้นหาสินค้าด้วยชื่อหรือ SKU...")}
              className="pl-9"
            />
          </div>
        </div>

        <div className="border rounded-xl divide-y max-h-72 overflow-y-auto">
          {searchResults.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">{__uiText("ไม่พบสินค้า")}</p>
          ) : (
            searchResults.map((product) => {
              const sku = product.product_inventory_sku;
              const checked = selectedSkuSet.has(sku);
              return (
                <label
                  key={product.product_inventory_id}
                  className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSku(sku)}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {product.product_name ?? __uiText("ไม่มีชื่อ")}
                    </p>
                    <p className="text-xs text-gray-500">{sku}</p>
                  </div>
                </label>
              );
            })
          )}
        </div>
      </div>
    </AdminInsertLayout>
  );
};

export default ProductVideoUpload;

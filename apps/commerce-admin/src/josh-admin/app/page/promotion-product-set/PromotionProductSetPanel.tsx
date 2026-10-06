import {
  getProducts,
  resolvePromotionSkus,
  type PromotionProductItem,
} from '@josh/shared-api';
import { ADMIN_PRODUCT_READ } from '../../config/admin-product-read';
import React, { useEffect, useMemo, useState } from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import { MdInsertDriveFile, MdOutlineAddCircle, MdOutlineDelete } from 'react-icons/md';
import { normalizeSearchProduct } from '../carousels/carousel-product.helpers';
import {
  downloadPromotionProductSetCsvTemplate,
  mergeProductItems,
  parseSkuCsv,
  resolveProductImageUrl,
} from './promotion-product-set.helpers';

const API_BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? 'https://joshapp.io/api';

type ManualItemsUpdater =
  | PromotionProductItem[]
  | ((prev: PromotionProductItem[]) => PromotionProductItem[]);

type Props = {
  manualItems: PromotionProductItem[];
  categoryItems: PromotionProductItem[];
  brandItems: PromotionProductItem[];
  onManualChange: (next: ManualItemsUpdater) => void;
};

export function PromotionProductSetPanel({
  manualItems,
  categoryItems,
  brandItems,
  onManualChange,
}: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResult, setSearchResult] = useState<
    ReturnType<typeof normalizeSearchProduct>[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [addMsg, setAddMsg] = useState('');
  const [filter, setFilter] = useState('');

  const items = useMemo(
    () => mergeProductItems(manualItems, categoryItems, brandItems),
    [manualItems, categoryItems, brandItems],
  );

  const filteredItems = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.sku.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle),
    );
  }, [items, filter]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResult([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const response: any = await getProducts(1, 20, searchTerm.trim(), ADMIN_PRODUCT_READ);
          const body = response?.data ?? response;
          const rows = Array.isArray(body?.data)
            ? body.data
            : Array.isArray(body?.data?.data)
              ? body.data.data
              : Array.isArray(body)
                ? body
                : [];
          setSearchResult(rows.map((row: Record<string, unknown>) => normalizeSearchProduct(row)));
        } catch {
          setSearchResult([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const isSelected = (sku: string) =>
    manualItems.some((item) => item.sku.toLowerCase() === sku.toLowerCase());

  /** เพิ่มรายการที่ resolve มาแล้วเข้า manualItems โดยอ่าน state ล่าสุดตอน apply — กันเคสกดเพิ่มพร้อมกันสองครั้งแล้วอันหนึ่งหาย */
  const addResolvedManualItems = (resolved: PromotionProductItem[]) => {
    onManualChange((prev) => {
      const existingIds = new Set(prev.map((item) => item.productInventoryId));
      const additions = resolved
        .filter((item) => !existingIds.has(item.productInventoryId))
        .map((item) => ({ ...item, source: 'manual' as const }));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  };

  const addBySku = async (sku: string): Promise<boolean> => {
    if (!sku) return false;
    if (isSelected(sku)) return true;
    try {
      const { items: resolved, inactive } = await resolvePromotionSkus([sku]);
      if (inactive.length > 0) {
        setAddMsg(`SKU ไม่ active (ไม่เพิ่ม): ${inactive.join(', ')}`);
        return false;
      }
      if (resolved.length === 0) {
        setAddMsg(`ไม่พบ SKU: ${sku}`);
        return false;
      }
      addResolvedManualItems(resolved);
      setAddMsg('');
      return true;
    } catch {
      setAddMsg(`เพิ่ม SKU ${sku} ไม่สำเร็จ`);
      return false;
    }
  };

  const addProduct = async (row: ReturnType<typeof normalizeSearchProduct>) => {
    if (!row.sku) return;
    const ok = await addBySku(row.sku);
    if (ok) {
      setSearchTerm('');
      setSearchResult([]);
    }
  };

  const removeManual = (productInventoryId: string) => {
    onManualChange((prev) => prev.filter((item) => item.productInventoryId !== productInventoryId));
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;
      void (async () => {
        setImporting(true);
        setImportMsg('');
        try {
          const skus = parseSkuCsv(text).filter((sku) => !isSelected(sku));
          if (skus.length === 0) {
            setImportMsg('ไม่พบ SKU ใหม่ในไฟล์');
            return;
          }
          const { items: resolved, notFound, inactive } = await resolvePromotionSkus(skus);
          addResolvedManualItems(resolved);
          if (notFound.length === 0 && inactive.length === 0) {
            setImportMsg(`นำเข้าสำเร็จ ${resolved.length} SKU`);
          } else {
            const parts = [`นำเข้า ${resolved.length} SKU`];
            if (inactive.length > 0) {
              parts.push(`SKU ไม่ active (ไม่เพิ่ม): ${inactive.join(', ')}`);
            }
            if (notFound.length > 0) {
              parts.push(`ไม่พบ ${notFound.length} รายการ: ${notFound.join(', ')}`);
            }
            setImportMsg(parts.join(' — '));
          }
        } catch {
          setImportMsg('นำเข้า CSV ไม่สำเร็จ');
        } finally {
          setImporting(false);
        }
      })();
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-2 border-b pb-3 md:flex-row md:items-center">
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-700">
            <AiOutlineSearch /> ค้นหาหรือเลือกสินค้าเข้า Product Set
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadPromotionProductSetCsvTemplate()}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-1.5 text-xs font-black text-gray-600 transition-colors hover:bg-gray-50"
            >
              <MdInsertDriveFile size={16} />
              ดาวน์โหลด CSV template
            </button>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-black text-primary transition-colors hover:bg-primary/20">
              <MdInsertDriveFile size={16} />
              <span>{importing ? 'กำลังนำเข้า...' : 'นำเข้า CSV'}</span>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                disabled={importing}
                onChange={handleCSVUpload}
              />
            </label>
          </div>
        </div>
        <p className="text-[11px] text-gray-400">
          ไฟล์ CSV คอลัมน์เดียว หัวตาราง <code>sku</code> — หนึ่งแถวต่อหนึ่ง SKU
        </p>
        {importMsg && <p className="text-xs text-amber-600">{importMsg}</p>}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">ค้นหาสินค้าเพื่อเพิ่มเข้า Product Set</span>
          <div className="relative">
            <input
              type="text"
              className="w-full rounded-xl border-none bg-gray-50 py-2 pl-10 pr-4 text-sm outline-none ring-primary/20 focus:ring-2"
              placeholder="ค้นหาชื่อสินค้า หรือ SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <AiOutlineSearch className="absolute left-3 top-3 text-gray-400" size={18} />
          </div>
        </label>

        {searching && <p className="text-xs text-gray-400">กำลังค้นหา...</p>}
        {addMsg && <p className="text-xs text-amber-600">{addMsg}</p>}

        <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
          {searchResult.map((row) => (
            <div
              key={`${row.sku}-${row.id}`}
              className="flex items-center justify-between rounded-xl border border-dashed p-2 text-xs"
            >
              <div className="min-w-0 pr-2">
                <p className="truncate font-medium text-gray-800">{row.name}</p>
                <p className="text-gray-400">
                  SKU: {row.sku} · ฿{row.price.toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                disabled={isSelected(row.sku)}
                onClick={() => void addProduct(row)}
                aria-label={`เพิ่ม ${row.sku}`}
                className="shrink-0 p-1 text-primary disabled:opacity-30"
              >
                <MdOutlineAddCircle size={22} />
              </button>
            </div>
          ))}
          {!searching && searchResult.length === 0 && (
            <p className="col-span-full py-4 text-center text-xs text-gray-400">
              {searchTerm.trim() ? 'ไม่พบสินค้า — ลองคำค้นอื่น' : 'พิมพ์ชื่อสินค้าหรือ SKU เพื่อค้นหา'}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-col justify-between gap-2 md:flex-row md:items-center">
          <h3 className="text-sm font-bold text-gray-700">
            รายการสินค้า ({items.length}) — เพิ่มเอง{' '}
            {items.filter((item) => item.source === 'manual').length} · จากหมวด{' '}
            {items.filter((item) => item.source === 'category').length} · จากแบรนด์{' '}
            {items.filter((item) => item.source === 'brand').length}
          </h3>
          <input
            type="text"
            className="w-full rounded-xl border-none bg-gray-50 py-2 px-3 text-sm outline-none ring-primary/20 focus:ring-2 md:w-64"
            placeholder="กรองรายการที่เลือก — ชื่อ/SKU"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="max-h-[28rem] space-y-2 overflow-y-auto">
          {filteredItems.map((item) => {
            const imgUrl =
              resolveProductImageUrl(item.imageUrl, API_BASE_URL) ??
              'https://placehold.co/150?text=No+Image';

            return (
              <div
                key={item.productInventoryId}
                className={`flex items-center justify-between rounded-xl border p-3 ${
                  item.isActive === false ? 'border-rose-300 bg-rose-50' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <img
                    src={imgUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg border object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://placehold.co/150?text=No+Image';
                    }}
                  />
                  <div className="min-w-0 truncate">
                    <p className="truncate text-xs font-bold text-gray-800">
                      {item.name}
                      {item.source === 'manual' && (
                        <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                          เพิ่มเอง
                        </span>
                      )}
                      {item.source === 'category' && (
                        <span className="ml-1.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">
                          {item.sourceLabel || 'หมวด'}
                        </span>
                      )}
                      {item.source === 'brand' && (
                        <span className="ml-1.5 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[9px] font-bold text-yellow-800">
                          Brand: {item.sourceLabel || 'Brand'}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      SKU: {item.sku} · ฿{(item.price ?? 0).toLocaleString()}
                      {item.isActive === false && (
                        <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-600">
                          ไม่ active
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {item.source === 'manual' && (
                  <button
                    type="button"
                    onClick={() => removeManual(item.productInventoryId)}
                    aria-label={`ลบ ${item.sku}`}
                    className="ml-2 shrink-0 rounded-full p-1.5 text-rose-500 hover:bg-rose-50"
                  >
                    <MdOutlineDelete size={18} />
                  </button>
                )}
              </div>
            );
          })}
          {filteredItems.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed py-10 text-center text-sm italic text-gray-400">
              {items.length === 0 ? 'ยังไม่มีสินค้า — ค้นหา นำเข้า CSV หรือเลือกหมวดหมู่' : 'ไม่พบสินค้าที่ตรงกับตัวกรอง'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PromotionProductSetPanel;

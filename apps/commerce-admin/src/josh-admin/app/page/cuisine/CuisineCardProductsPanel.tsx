import {
  addCuisineCardProductsAdmin,
  downloadCuisineCardProductsTemplate,
  getProducts,
  importCuisineCardProductsAdmin,
  listCuisineCardProductsAdmin,
  removeCuisineCardProductsAdmin,
  type CuisineCardProductAdmin,
  type CuisineSkuMutationResult,
} from '@josh/shared-api';
import { ADMIN_PRODUCT_READ } from '../../config/admin-product-read';
import { DragDropUpload } from '@josh/shared-ui-web';
import { useCallback, useEffect, useState } from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import { MdOutlineAddCircle, MdOutlineDelete } from 'react-icons/md';
import { resolveAdminAssetUrl } from '../../lib/asset-url';

type SearchRow = {
  id: string;
  sku: string;
  name: string;
  price: number;
};

function normalizeSearchProduct(row: Record<string, unknown>): SearchRow {
  const product = (row.product as Record<string, unknown> | undefined) ?? {};
  const sku = String(
    row.product_inventory_sku ?? row.sku ?? product.sku ?? '',
  ).trim();
  const name = String(
    row.product_name ??
      row.name ??
      product.name ??
      product.product_name ??
      sku,
  );
  // Admin picker: catalog prices (base_*) first — resolved_price / selling_unit_price /
  // ordering_price on the payload are priced like the shop (promotion, customer price).
  const price = Number(
    row.base_selling_price ??
      row.selling_unit_price ??
      row.base_ordering_price ??
      row.ordering_price ??
      product.price ??
      0,
  );
  return {
    id: String(row.product_inventory_id ?? row.id ?? sku),
    sku,
    name,
    price: Number.isFinite(price) ? price : 0,
  };
}

/** Minimal CSV parser for draft import (header `sku`). */
function parseSkusFromCsvText(text: string): string[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const skuIdx = headers.findIndex((h) => h === 'sku');
  if (skuIdx < 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    const sku = cells[skuIdx] ?? '';
    if (!sku) continue;
    const key = sku.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sku);
  }
  return out;
}

type Props = {
  /** When set, mutations hit the API. When null/undefined, panel runs in draft mode. */
  cardId?: string | null;
  /** Saved taxonomy on the card — informational; SKU add auto-provisions if null. */
  cuisineId: string | null;
  /** Called after SKU mutations that may have auto-bound taxonomy. */
  onTaxonomyMaybeChanged?: (cuisineId?: string) => void;
  /** Fired after list load / mutate so parent can refresh taxonomy summary. */
  onBindingsChanged?: () => void;
  /** Draft product rows while creating a card (controlled). */
  draftProducts?: CuisineCardProductAdmin[];
  onDraftProductsChange?: (products: CuisineCardProductAdmin[]) => void;
};

export function CuisineCardProductsPanel({
  cardId,
  cuisineId,
  onTaxonomyMaybeChanged,
  onBindingsChanged,
  draftProducts,
  onDraftProductsChange,
}: Props) {
  const isDraft = !cardId;
  const [persistedProducts, setPersistedProducts] = useState<CuisineCardProductAdmin[]>([]);
  const [boundTotal, setBoundTotal] = useState(0);
  const [boundFilter, setBoundFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResult, setSearchResult] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [busySku, setBusySku] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<CuisineSkuMutationResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const products = isDraft ? (draftProducts ?? []) : persistedProducts;

  const setDraft = (next: CuisineCardProductAdmin[]) => {
    onDraftProductsChange?.(next);
  };

  const loadProducts = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    setError(null);
    try {
      // การ์ดใหญ่มี SKU หลักพัน — backend ส่งมาชุดแรก + total จริง ที่เหลือค้นด้วย boundFilter
      const page = await listCuisineCardProductsAdmin(cardId, { search: boundFilter });
      setPersistedProducts(page.rows);
      setBoundTotal(page.total);
    } catch {
      setError('โหลดรายการสินค้าไม่สำเร็จ');
      setPersistedProducts([]);
      setBoundTotal(0);
    } finally {
      setLoading(false);
    }
  }, [cardId, boundFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProducts(), boundFilter ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [loadProducts, boundFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const response: unknown = await getProducts(1, 20, searchTerm.trim(), ADMIN_PRODUCT_READ);
          const body = (response as { data?: unknown })?.data ?? response;
          const nested = body as { data?: unknown };
          const rows = Array.isArray(nested?.data)
            ? nested.data
            : Array.isArray((nested?.data as { data?: unknown })?.data)
              ? ((nested.data as { data: unknown[] }).data)
              : Array.isArray(body)
                ? body
                : [];
          setSearchResult(
            (rows as Record<string, unknown>[]).map(normalizeSearchProduct).filter((r) => r.sku),
          );
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
    products.some((item) => item.sku.toLowerCase() === sku.toLowerCase());

  const notifyTaxonomy = (result: CuisineSkuMutationResult) => {
    if (result.cuisine_id && result.cuisine_id !== cuisineId) {
      onTaxonomyMaybeChanged?.(result.cuisine_id);
    }
    onBindingsChanged?.();
  };

  const handleAdd = async (row: SearchRow) => {
    if (!row.sku || isSelected(row.sku)) return;
    if (isDraft) {
      setDraft([
        ...products,
        {
          product_inventory_id: row.id,
          sku: row.sku,
          name: row.name,
          product_image_url: null,
        },
      ]);
      return;
    }
    setBusySku(row.sku);
    setError(null);
    try {
      const result = await addCuisineCardProductsAdmin(cardId, [row.sku]);
      if (result.invalid.includes(row.sku)) {
        setError(`ไม่พบ SKU: ${row.sku}`);
      }
      notifyTaxonomy(result);
      await loadProducts();
    } catch {
      setError('เพิ่มสินค้าไม่สำเร็จ');
    } finally {
      setBusySku(null);
    }
  };

  const handleRemove = async (sku: string) => {
    if (isDraft) {
      setDraft(products.filter((p) => p.sku.toLowerCase() !== sku.toLowerCase()));
      return;
    }
    setBusySku(sku);
    setError(null);
    try {
      await removeCuisineCardProductsAdmin(cardId, [sku]);
      await loadProducts();
      onBindingsChanged?.();
    } catch {
      setError('ลบสินค้าไม่สำเร็จ');
    } finally {
      setBusySku(null);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      // Template content does not depend on card id — use placeholder when drafting.
      const blob = await downloadCuisineCardProductsTemplate(cardId ?? 'draft');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cuisine-products-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('ดาวน์โหลด template ไม่สำเร็จ');
    }
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportSummary(null);
    setError(null);
    try {
      if (isDraft) {
        const lower = file.name.toLowerCase();
        if (!lower.endsWith('.csv')) {
          setError('ตอนสร้างการ์ดนำเข้าได้เฉพาะ .csv — หรือบันทึกการ์ดก่อนแล้วค่อยอัปโหลด .xlsx');
          return;
        }
        const text = await file.text();
        const skus = parseSkusFromCsvText(text);
        if (skus.length === 0) {
          setError('ไม่พบคอลัมน์ sku ในไฟล์');
          return;
        }
        const existing = new Set(products.map((p) => p.sku.toLowerCase()));
        const added: string[] = [];
        const skipped: string[] = [];
        const next = [...products];
        for (const sku of skus) {
          if (existing.has(sku.toLowerCase())) {
            skipped.push(sku);
            continue;
          }
          existing.add(sku.toLowerCase());
          next.push({
            product_inventory_id: sku,
            sku,
            name: sku,
            product_image_url: null,
          });
          added.push(sku);
        }
        setDraft(next);
        setImportSummary({ added, skipped, invalid: [] });
        return;
      }
      const result = await importCuisineCardProductsAdmin(cardId, file);
      setImportSummary(result);
      notifyTaxonomy(result);
      await loadProducts();
    } catch {
      setError('นำเข้าไฟล์ไม่สำเร็จ — ตรวจคอลัมน์ sku และชนิดไฟล์ .xlsx/.csv');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">
            SKU ที่ผูกกับ Taxonomy ({isDraft ? products.length : boundTotal})
          </p>
          <p className="text-xs text-ink-muted">
            {isDraft
              ? 'เลือก SKU ไว้ก่อน — จะผูกหลังกดบันทึกสร้างการ์ด'
              : cuisineId
                ? 'แท็กบน taxonomy ที่เลือกและประเภทย่อยของมัน (product_inventory_cuisine) — ไม่รวมสินค้าที่มาจากหมวดหมู่'
                : 'ยังไม่ผูก taxonomy — เพิ่ม SKU ครั้งแรกระบบจะสร้าง/ผูกประเภทอาหารจากชื่อการ์ดให้อัตโนมัติ'}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-primary-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
          onClick={() => void handleDownloadTemplate()}
        >
          ดาวน์โหลด CSV template
        </button>
      </div>

      {error && <p className="text-sm text-alert">{error}</p>}

      <div className="space-y-3 rounded-xl border border-primary-border bg-white p-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-ink">
          <AiOutlineSearch /> ค้นหาเพื่อเพิ่มสินค้า
        </p>
        <input
          type="text"
          className="w-full rounded-lg border border-primary-border bg-gray-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="ค้นหาชื่อสินค้า หรือ SKU..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searching && <p className="text-xs text-ink-muted">กำลังค้นหา...</p>}
        <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
          {searchResult.map((row) => (
            <div
              key={`${row.sku}-${row.id}`}
              className="flex items-center justify-between rounded-lg border border-dashed border-primary-border p-2 text-xs"
            >
              <div className="min-w-0 pr-2">
                <p className="truncate font-medium text-ink">{row.name}</p>
                <p className="text-ink-muted">
                  SKU: {row.sku}
                  {row.price > 0 ? ` · ฿${row.price.toLocaleString()}` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={isSelected(row.sku) || busySku === row.sku}
                onClick={() => void handleAdd(row)}
                className="shrink-0 p-1 text-primary disabled:opacity-30"
                aria-label={`เพิ่ม ${row.sku}`}
              >
                <MdOutlineAddCircle size={22} />
              </button>
            </div>
          ))}
          {!searching && searchResult.length === 0 && (
            <p className="col-span-full py-3 text-center text-xs text-ink-muted">
              {searchTerm.trim()
                ? 'ไม่พบสินค้า — ลองคำค้นอื่น'
                : 'พิมพ์ชื่อสินค้าหรือ SKU เพื่อค้นหา'}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-primary-border bg-white p-4">
        <p className="text-xs font-semibold text-ink">
          {isDraft
            ? 'นำเข้า CSV (append · คอลัมน์ sku) — .xlsx ใช้ได้หลังบันทึกการ์ด'
            : 'นำเข้า Excel / CSV (append · คอลัมน์ sku)'}
        </p>
        <DragDropUpload
          accept={
            isDraft
              ? '.csv,text/csv'
              : '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
          }
          maxSizeMB={10}
          onFileSelect={(file) => void handleImportFile(file)}
        />
        {importing && <p className="text-xs text-primary">กำลังนำเข้า...</p>}
        {importSummary && (
          <p className="text-xs text-ink-muted">
            เพิ่ม {importSummary.added.length} · ข้าม (มีแล้ว){' '}
            {importSummary.skipped.length} · ไม่พบ/ไม่ถูกต้อง{' '}
            {importSummary.invalid.length}
            {importSummary.invalid.length > 0
              ? ` (${importSummary.invalid.slice(0, 5).join(', ')}${
                  importSummary.invalid.length > 5 ? '…' : ''
                })`
              : ''}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-primary-border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ink">
            รายการที่{isDraft ? 'เลือกไว้' : 'แท็กแล้ว'} (
            {isDraft ? products.length : boundTotal})
          </p>
          {!isDraft && (
            <input
              type="text"
              className="w-56 rounded-lg border border-primary-border bg-gray-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="กรองในรายการที่ผูก (SKU/ชื่อ)"
              value={boundFilter}
              onChange={(e) => setBoundFilter(e.target.value)}
            />
          )}
        </div>
        {!isDraft && !loading && boundTotal > products.length && (
          <p className="mb-2 text-xs text-amber-700">
            แสดง {products.length} จาก {boundTotal.toLocaleString()} รายการ — พิมพ์ในช่องกรอง
            เพื่อหาตัวที่เหลือ
          </p>
        )}
        {loading ? (
          <p className="text-xs text-ink-muted">กำลังโหลด...</p>
        ) : products.length === 0 ? (
          <p className="text-xs text-ink-muted">
            {isDraft
              ? 'ยังไม่ได้เลือกสินค้า — ค้นหาหรืออัปโหลด CSV'
              : boundFilter
                ? 'ไม่พบ SKU ที่ตรงกับคำกรอง'
                : 'ยังไม่มีสินค้า — ค้นหาหรืออัปโหลด Excel'}
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {products.map((item) => {
              const img = resolveAdminAssetUrl(item.product_image_url);
              return (
                <li
                  key={item.product_inventory_id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-primary-border px-2 py-1.5"
                >
                  {img ? (
                    <img
                      src={img}
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded bg-gray-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {item.name ?? item.sku}
                    </p>
                    <p className="truncate text-xs text-ink-muted">
                      {item.sku}
                      {item.is_direct_tag === false && item.tagged_cuisine_name ? (
                        <span
                          className="ml-2 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] text-ink-secondary"
                          title="แท็กไว้ที่ประเภทย่อย ไม่ใช่ตัวการ์ดโดยตรง"
                        >
                          {item.tagged_cuisine_name}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busySku === item.sku}
                    onClick={() => void handleRemove(item.sku)}
                    className="p-1 text-alert disabled:opacity-40"
                    aria-label={`ลบ ${item.sku}`}
                  >
                    <MdOutlineDelete size={20} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

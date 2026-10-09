// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
export type CarouselProductItem = {
  id: string;
  sku: string;
  display_order: number;
  product_image_url?: string | null;
  is_active?: boolean;
  product: {
    name: string;
    sku: string;
    price: number;
  };
};

export function getProductSku(item: CarouselProductItem): string {
  return item.sku || item.product?.sku || '';
}

export function normalizeSearchProduct(
  raw: Record<string, unknown>,
): {
  id: string;
  sku: string;
  name: string;
  price: number;
  product_image_url: string | null;
} {
  const id = String(raw.product_inventory_id ?? raw.product_id ?? '');
  const sku = String(raw.product_inventory_sku ?? raw.sku ?? '');
  const name = String(raw.product_name ?? raw.name ?? sku);
  // Admin picker: the catalog price (base_selling_price), not the shop-priced selling_price
  // (a promotion mechanic lowers it, a customer price nulls it).
  const price = Number(
    raw.base_selling_price ?? raw.selling_price ?? raw.price ?? 0,
  );
  const media = raw.media as
    | Array<{ media_type?: string; source?: string; url?: string }>
    | undefined;
  const image = media?.find((row) => row.media_type === 'image');
  const product_image_url = image?.source ?? image?.url ?? null;

  return { id, sku, name, price, product_image_url };
}

export function toCarouselProductItem(
  raw: Record<string, unknown>,
  displayOrder: number,
): CarouselProductItem {
  const normalized = normalizeSearchProduct(raw);
  return {
    id: normalized.id || `temp-${Date.now()}-${Math.random()}`,
    sku: normalized.sku,
    display_order: displayOrder,
    product_image_url: normalized.product_image_url,
    product: {
      name: normalized.name,
      sku: normalized.sku,
      price: normalized.price,
    },
  };
}

export function fromApiCarouselProduct(
  raw: Record<string, unknown>,
  index: number,
): CarouselProductItem {
  const sku = String(raw.sku ?? raw.product?.sku ?? '');
  const product = (raw.product as Record<string, unknown>) ?? {};
  return {
    id: String(raw.id ?? `loaded-${sku}-${index}`),
    sku,
    display_order: Number(raw.display_order ?? raw.sort_order ?? index + 1),
    product_image_url:
      typeof raw.product_image_url === 'string' ? raw.product_image_url : null,
    is_active: raw.is_active === undefined ? true : Boolean(raw.is_active),
    product: {
      name: String(product.name ?? sku),
      sku: String(product.sku ?? sku),
      price: Number(product.price ?? 0),
    },
  };
}

export function reindexProducts(
  items: CarouselProductItem[],
): CarouselProductItem[] {
  return items.map((item, index) => ({
    ...item,
    display_order: index + 1,
  }));
}

export function buildSaveErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: Record<string, unknown> } })
    ?.response?.data;
  const message = (data?.message as string) || 'บันทึกไม่สำเร็จ';
  const invalidSkus = data?.invalid_skus as string[] | undefined;
  if (Array.isArray(invalidSkus) && invalidSkus.length > 0) {
    return `${message}: ${invalidSkus.join(', ')}`;
  }
  return message;
}

export function productsToPayload(items: CarouselProductItem[]) {
  return items
    .map((item, index) => ({
      sku: getProductSku(item),
      display_order: item.display_order ?? index + 1,
    }))
    .filter((item) => item.sku);
}

/**
 * CSV columns match `CarouselProductPanel` import:
 * 0=sku (required), 1=display_order, 2=name, 3=price
 */
export const CAROUSEL_PRODUCTS_CSV_TEMPLATE = [
  'รหัสสินค้า,ลำดับ,ชื่อสินค้า,ราคา',
  'SKU-001,1,ตัวอย่างสินค้า A,120',
  'SKU-002,2,ตัวอย่างสินค้า B,250',
  'SKU-003,3,,',
].join('\n');

export const CAROUSEL_PRODUCTS_CSV_TEMPLATE_FILENAME =
  'carousel-products-template.csv';

/** Trigger a browser download of the carousel SKU CSV template (client-only). */
export function downloadCarouselProductsCsvTemplate(): void {
  // BOM so Excel on Windows opens Thai headers correctly
  const blob = new Blob([`\uFEFF${CAROUSEL_PRODUCTS_CSV_TEMPLATE}\n`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = CAROUSEL_PRODUCTS_CSV_TEMPLATE_FILENAME;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

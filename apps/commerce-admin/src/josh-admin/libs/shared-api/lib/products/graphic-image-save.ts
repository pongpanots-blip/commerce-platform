/** Graphic image saves. PATCH /product/:id stays closed — that route also writes price and status. */

export function skuImageName(sku: string, index: number, filename: string): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  return `${sku}_${index + 1}${ext}`;
}

export function galleryWithout(gallery: string[], sources: string[]): string[] {
  const drop = sources.filter(Boolean);
  return gallery.filter((url) => !drop.some((source) => url === source || url.endsWith(source)));
}

export type GraphicImageCall = { op: 'upload' | 'set'; path: string } | { op: 'bulk'; path: '/product/images/bulk-upload' };

/** `owned` is COMMERCE_OWNS_PRODUCT_IMAGES. A josh-owned gallery can gain images; deleting one is the closed PATCH. */
export function graphicImageCalls(owned: boolean, sku: string, fileCount: number, removing: boolean): GraphicImageCall[] {
  const enc = encodeURIComponent(sku);
  if (owned) {
    const calls: GraphicImageCall[] = [];
    if (removing) calls.push({ op: 'set', path: `/product-images/${enc}` });
    if (fileCount) calls.push({ op: 'upload', path: `/product-images/${enc}/upload` });
    return calls;
  }
  if (fileCount) return [{ op: 'bulk', path: '/product/images/bulk-upload' }];
  return [];
}

import { galleryWithout, graphicImageCalls, skuImageName } from './graphic-image-save';

describe('graphic image save', () => {
  it('names files the way bulk upload expects and never uses PATCH /product/:id', () => {
    expect(skuImageName('SKU-1', 0, 'photo.PNG')).toBe('SKU-1_1.png');
    const owned = graphicImageCalls(true, 'SKU 1', 2, true);
    const josh = graphicImageCalls(false, 'SKU-1', 1, true);
    const addOnly = graphicImageCalls(false, 'SKU-1', 1, false);
    const removeOnly = graphicImageCalls(false, 'SKU-1', 0, true);
    expect(owned).toEqual([
      { op: 'set', path: '/product-images/SKU%201' },
      { op: 'upload', path: '/product-images/SKU%201/upload' },
    ]);
    expect(josh).toEqual([{ op: 'bulk', path: '/product/images/bulk-upload' }]);
    expect(addOnly).toEqual(josh);
    expect(removeOnly).toEqual([]);
    for (const call of [...owned, ...josh, ...addOnly, ...removeOnly]) {
      expect(call).not.toMatchObject({ path: expect.stringMatching(/^\/product\/[^/]+$/) });
    }
    expect(galleryWithout(['https://cdn/uploads/a.jpg', 'https://cdn/uploads/b.jpg'], ['https://cdn/uploads/a.jpg', '/uploads/b.jpg'])).toEqual([]);
    expect(galleryWithout(['https://cdn/a.jpg'], ['https://cdn/c.jpg'])).toEqual(['https://cdn/a.jpg']);
  });
});

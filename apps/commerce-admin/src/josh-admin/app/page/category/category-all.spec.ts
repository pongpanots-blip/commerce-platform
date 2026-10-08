import { categoryImageUploadCall } from '../../../libs/shared-api/lib/product-category/category-image';
import { ALL_CATEGORY_ID, pinAllCategoryFirst, withoutAllAtRoot } from './category-all';

describe('category image and ALL pin', () => {
  it('uploads the icon to commerce, never josh /upload/image or the sheet import', () => {
    expect(categoryImageUploadCall()).toEqual({ method: 'POST', path: '/product-category/image', field: 'file', client: 'commerce' });
    expect(categoryImageUploadCall().path).not.toBe('/upload/image');
    expect(categoryImageUploadCall().path).not.toBe('/product-category/upload');
  });

  it('pins ALL first and keeps it out of the division list', () => {
    const all = { category_id_uuid: ALL_CATEGORY_ID };
    const other = { category_id_uuid: '00000000-0000-4000-8000-0000000000b2' };
    expect(pinAllCategoryFirst([other, all])).toEqual([all, other]);
    expect(pinAllCategoryFirst([other])).toEqual([other]);
    expect(withoutAllAtRoot([all, other], null)).toEqual([other]);
    expect(withoutAllAtRoot([all, other], other.category_id_uuid)).toEqual([all, other]);
  });
});
/** Always commerce. A failed ownership read must not send this file to josh's /upload/image. */
export const CATEGORY_IMAGE_UPLOAD_PATH = '/product-category/image';
export const CATEGORY_IMAGE_FIELD = 'file';

export function categoryImageUploadCall() {
  return { method: 'POST' as const, path: CATEGORY_IMAGE_UPLOAD_PATH, field: CATEGORY_IMAGE_FIELD, client: 'commerce' as const };
}

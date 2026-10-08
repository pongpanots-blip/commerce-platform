jest.mock('../../../shared-kernel/infrastructure/media-s3', () => ({
  putMediaObject: jest.fn(async (key: string) => `https://bucket.example/${key}`),
}));

import { putMediaObject } from '../../../shared-kernel/infrastructure/media-s3';
import { ALL_CATEGORY_ID, level1NumberedIds } from './category-rules';
import { ProductCategoriesService } from './product-categories.service';

const file = (name: string, size = 4) => ({ originalname: name, buffer: Buffer.from('x'), mimetype: 'image/png', size });

describe('category image upload', () => {
  const svc = new ProductCategoriesService({} as never, {} as never);
  const previous = process.env.COMMERCE_OWNS_CATEGORIES;

  beforeEach(() => {
    process.env.COMMERCE_OWNS_CATEGORIES = 'true';
    jest.mocked(putMediaObject).mockClear();
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.COMMERCE_OWNS_CATEGORIES;
    else process.env.COMMERCE_OWNS_CATEGORIES = previous;
  });

  it('stores the file under uploads/categories and returns the logo envelope', async () => {
    const res = await svc.uploadImage(file('icon.PNG'));
    expect(res).toMatchObject({ status: true, statusCode: 200, data: { filename: 'icon.PNG' } });
    expect(res.data.url).toContain('uploads/categories/images-');
    expect(putMediaObject).toHaveBeenCalledWith(expect.stringMatching(/^uploads\/categories\/images-.*\.png$/), expect.any(Buffer), 'image/png');
  });

  it('rejects an empty file, a file over 5 MB, and a type outside jpg/png/gif/webp', async () => {
    await expect(svc.uploadImage(undefined)).rejects.toThrow('ไม่มีไฟล์รูป');
    await expect(svc.uploadImage(file('a.jpg', 5 * 1024 * 1024 + 1))).rejects.toThrow('ใหญ่เกิน 5 MB');
    await expect(svc.uploadImage(file('a.svg'))).rejects.toThrow('webp');
  });

  it('refuses the upload when commerce does not own categories', async () => {
    delete process.env.COMMERCE_OWNS_CATEGORIES;
    await expect(svc.uploadImage(file('a.jpg'))).rejects.toThrow('COMMERCE_OWNS_CATEGORIES');
  });

  it('refuses to delete ALL and keeps that id out of numbered reorder', async () => {
    await expect(svc.remove(ALL_CATEGORY_ID)).rejects.toThrow('ลบไม่ได้');
    expect(level1NumberedIds(['b', ALL_CATEGORY_ID, 'a'])).toEqual(['b', 'a']);
  });
});

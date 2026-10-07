import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../shared-kernel/interfaces/event-bus.interface';
import { skuAggregateId } from '../product-prices/product-price-snapshot.event';
import { parseSkuFromFilename, ProductImagesService } from './product-images.service';

jest.mock('../../../shared-kernel/infrastructure/media-s3', () => ({
  putMediaObject: jest.fn(async (key: string) => `https://bucket.example/${key}`),
}));

/*
 * Stage 4e: product galleries in commerce (S3 mocked). Opt-in, migrated scratch DB:
 *   IMAGES_TEST_DATABASE_URL=postgres:///commerce_4e_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand product-images.service.db
 */
const url = process.env.IMAGES_TEST_DATABASE_URL;
const SKU = 'T4E-SKU';
const file = (name: string, size = 10) => ({ originalname: name, buffer: Buffer.from('x'), mimetype: 'image/jpeg', size });

it('parseSkuFromFilename follows josh', () => {
  expect(parseSkuFromFilename('JG001_2.jpg')).toEqual({ sku: 'JG001', sequence: 2 });
  expect(parseSkuFromFilename('JG_001.png')).toEqual({ sku: 'JG', sequence: 1 });
  expect(parseSkuFromFilename('JG001.jpg')).toEqual({ sku: 'JG001', sequence: null });
});

(url ? describe : describe.skip)('ProductImagesService against a database', () => {
  let db: DataSource;
  let svc: ProductImagesService;
  const clean = async () => {
    await db.query(`DELETE FROM outbox_messages WHERE aggregate_id = $1`, [skuAggregateId(SKU, 'images')]);
    await db.query(`DELETE FROM product_images WHERE product_inventory_sku = $1`, [SKU]);
  };
  const gallery = async () => (await svc.get(SKU)).images;
  const lastSnap = async () => (await db.query(`SELECT payload FROM outbox_messages WHERE aggregate_id = $1 ORDER BY created_at DESC LIMIT 1`, [skuAggregateId(SKU, 'images')]))[0]?.payload;

  beforeAll(async () => {
    process.env.COMMERCE_OWNS_PRODUCT_IMAGES = 'true';
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [OutboxMessage] }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [ProductImagesService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(ProductImagesService);
    await clean();
    await db.query(`INSERT INTO product_images (product_inventory_sku, images) VALUES ($1, '["https://bucket.example/a.jpg"]')`, [SKU]);
  });
  afterAll(async () => { await clean(); await db?.destroy(); delete process.env.COMMERCE_OWNS_PRODUCT_IMAGES; });

  it('upload appends (≤3), set removes / reorders known images only, each change sends the gallery', async () => {
    await svc.upload(SKU, [file('one.jpg'), file('two.png')], 'staff-1');
    const [a, b, c] = await gallery();
    expect(b).toMatch(/^https:\/\/bucket\.example\/uploads\/products\/images-.*\.jpg$/);
    await expect(svc.upload(SKU, [file('four.jpg')], 's')).rejects.toThrow('สูงสุด 3 รูป');
    await expect(svc.upload(SKU, [file('big.jpg', 6 * 1024 * 1024)], 's')).rejects.toThrow('5 MB');
    await svc.set(SKU, [c, a], 'staff-1');
    expect(await gallery()).toEqual([c, a]);
    expect((await lastSnap()).images).toEqual([c, a]);
    await expect(svc.set(SKU, ['https://elsewhere.example/x.jpg'], 's')).rejects.toThrow('อัปโหลดก่อน');
  });

  it('bulk: append and replace by file name, bad files reported; ERP replaces the gallery', async () => {
    const r = await svc.bulk([file(`${SKU}_1.jpg`), file('NOPE_1.jpg'), file(`${SKU}.txt`)], 'replace', 'staff-1');
    expect(r.failed).toEqual([{ filename: 'NOPE_1.jpg', reason: 'sku_not_found' }, { filename: `${SKU}.txt`, reason: 'missing_sequence' }]);
    const images = await gallery();
    expect(images).toHaveLength(2);
    expect(images[0]).toMatch(new RegExp(`/${SKU}/${SKU}_`));
    await db.transaction((m) => svc.fromErp(m, { PRODUCT_CODE: SKU, IMAGES: ['https://erp.example/1.jpg', 'https://erp.example/2.jpg', 'https://erp.example/3.jpg', 'https://erp.example/4.jpg'] }));
    expect(await gallery()).toHaveLength(4);
    process.env.COMMERCE_OWNS_PRODUCT_IMAGES = 'false';
    try {
      await expect(svc.set(SKU, [], 's')).rejects.toThrow('COMMERCE_OWNS_PRODUCT_IMAGES');
      expect(await db.transaction((m) => svc.fromErp(m, { PRODUCT_CODE: SKU, IMAGES: [] }))).toBe(0);
    } finally { process.env.COMMERCE_OWNS_PRODUCT_IMAGES = 'true'; }
  });
});

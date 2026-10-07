import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { extname } from 'path';
import { DataSource, EntityManager } from 'typeorm';
import { putMediaObject } from '../../../shared-kernel/infrastructure/media-s3';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { ProductImagesSnapshot } from './product-images-snapshot.event';

export const ownsProductImages = () => process.env.COMMERCE_OWNS_PRODUCT_IMAGES === 'true';

/** The multer fields the upload routes hand over (memory storage). */
export interface ImageFile { originalname: string; buffer: Buffer; mimetype: string; size: number }

/** josh's rules: 3 images per gallery from the product page, 5 MB, jpg / png / gif / webp, SKU safe in an S3 key. */
export const MAX_GALLERY = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const SKU_KEY_SAFE = /^[A-Za-z0-9._-]+$/;
const suffix = () => `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

/** josh parseSkuFromFilename: `SKU_2.jpg` → { SKU, 2 }, `SKU.jpg` → { SKU, null }. */
export function parseSkuFromFilename(name: string): { sku: string; sequence: number | null } | null {
  const base = name.trim().replace(/\.[^.]*$/, '');
  if (!base) return null;
  const m = /^(.+)_(\d+)$/.exec(base);
  return m ? { sku: m[1], sequence: Number(m[2]) } : { sku: base, sequence: null };
}

type BulkFailure = 'invalid_filename' | 'missing_sequence' | 'sku_not_found' | 'file_too_large' | 'unsupported_type' | 'upload_failed';

/**
 * Product galleries owned by commerce (stage 4e, COMMERCE_OWNS_PRODUCT_IMAGES): ordered image URLs per SKU. Files go to
 * josh's media bucket with josh's key shapes; every change publishes product.images.snapshot (whole gallery) in the
 * same transaction, and josh makes the list thumbnails when it applies it.
 */
@Injectable()
export class ProductImagesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}

  async get(sku: string): Promise<{ sku: string; images: string[] }> {
    const [row] = await this.db.query(`SELECT images FROM product_images WHERE product_inventory_sku = $1`, [sku]);
    if (!row) throw new NotFoundException(`ไม่มีรูปของ SKU ${sku} ใน commerce`);
    return { sku, images: row.images };
  }

  /** Product page: add images at the end (gallery ≤ 3). */
  async upload(sku: string, files: ImageFile[], staffId: string) {
    this.assertOwned();
    if (!files.length) throw new BadRequestException('ไม่มีไฟล์รูป');
    for (const f of files) this.assertFile(f);
    await this.assertKnown(this.db.manager, sku);
    const urls: string[] = [];
    for (const f of files) urls.push(await putMediaObject(`uploads/products/images-${suffix()}${extname(f.originalname).toLowerCase()}`, f.buffer, f.mimetype));
    return this.change(sku, staffId, 'staff', (current) => {
      if (current.length + urls.length > MAX_GALLERY) throw new BadRequestException(`รูปภาพได้สูงสุด ${MAX_GALLERY} รูป`);
      return [...current, ...urls];
    });
  }

  /** Product page: remove / reorder — only images already in the gallery. */
  async set(sku: string, images: string[], staffId: string) {
    this.assertOwned();
    if (new Set(images).size !== images.length) throw new BadRequestException('มีรูปซ้ำ');
    if (images.length > MAX_GALLERY) throw new BadRequestException(`รูปภาพได้สูงสุด ${MAX_GALLERY} รูป`);
    return this.change(sku, staffId, 'staff', (current) => {
      const unknown = images.filter((u) => !current.includes(u));
      if (unknown.length) throw new BadRequestException('มีรูปที่ไม่ได้อยู่ในแกลเลอรีของสินค้านี้ — อัปโหลดก่อน');
      return images;
    });
  }

  /**
   * Bulk upload by file name (josh's rule): `SKU_<n>.jpg`; append adds at the end, replace puts the file in slot n
   * (inserts if that slot is empty). One bad file never fails the batch. No undo log (josh's history stays in josh).
   */
  async bulk(files: ImageFile[], mode: 'append' | 'replace', staffId: string) {
    this.assertOwned();
    const failed: Array<{ filename: string; reason: BulkFailure }> = [];
    const appended: Array<{ filename: string; sku: string; url: string }> = [];
    const bySku = new Map<string, Array<{ filename: string; url: string; slot: number | null }>>();
    const known = new Map<string, string>(); // lower → SKU as josh has it
    for (const f of files) {
      const parsed = parseSkuFromFilename(f.originalname);
      if (!parsed) { failed.push({ filename: f.originalname, reason: 'invalid_filename' }); continue; }
      if (mode === 'replace' && parsed.sequence === null) { failed.push({ filename: f.originalname, reason: 'missing_sequence' }); continue; }
      const sku = known.get(parsed.sku.toLowerCase()) ?? (await this.findSku(parsed.sku));
      if (!sku || !SKU_KEY_SAFE.test(sku)) { failed.push({ filename: f.originalname, reason: 'sku_not_found' }); continue; }
      known.set(parsed.sku.toLowerCase(), sku);
      if (f.size > MAX_BYTES) { failed.push({ filename: f.originalname, reason: 'file_too_large' }); continue; }
      if (!IMAGE_EXT.test(f.originalname)) { failed.push({ filename: f.originalname, reason: 'unsupported_type' }); continue; }
      try {
        const url = await putMediaObject(`${sku}/${sku}_${suffix()}${extname(f.originalname).toLowerCase()}`, f.buffer, f.mimetype);
        bySku.set(sku, [...(bySku.get(sku) ?? []), { filename: f.originalname, url, slot: parsed.sequence }]);
      } catch {
        failed.push({ filename: f.originalname, reason: 'upload_failed' });
      }
    }
    for (const [sku, uploads] of bySku) {
      await this.change(sku, staffId, 'staff', (current) => {
        const next = [...current];
        for (const u of uploads) {
          if (mode === 'replace' && u.slot! >= 1 && u.slot! <= next.length) next[u.slot! - 1] = u.url;
          else next.push(u.url);
        }
        return next;
      });
      appended.push(...uploads.map((u) => ({ filename: u.filename, sku, url: u.url })));
    }
    return { appended, failed };
  }

  /** ERP `PUT /erp/products/image` (relayed to josh in the same transaction, or a replayed fallback call): full replace. */
  async fromErp(m: EntityManager, body: unknown): Promise<number> {
    if (!ownsProductImages()) return 0;
    let applied = 0;
    for (const item of Array.isArray(body) ? body : [body]) {
      const { PRODUCT_CODE: sku, IMAGES: images } = (item ?? {}) as { PRODUCT_CODE?: unknown; IMAGES?: unknown };
      if (typeof sku !== 'string' || !Array.isArray(images) || images.some((u) => typeof u !== 'string')) continue;
      if (!(await this.isKnown(m, sku))) continue; // josh skipped unknown SKUs too
      await this.write(m, sku, images as string[], 'erp', null);
      applied++;
    }
    return applied;
  }

  private async change(sku: string, staffId: string, source: string, next: (current: string[]) => string[]) {
    return this.db.transaction(async (m) => {
      await this.assertKnown(m, sku);
      const [row] = await m.query(`SELECT images FROM product_images WHERE product_inventory_sku = $1 FOR UPDATE`, [sku]);
      return this.write(m, sku, next(row?.images ?? (await this.joshImages(m, sku))), source, staffId);
    });
  }

  private async write(m: EntityManager, sku: string, images: string[], source: string, staffId: string | null) {
    await m.query(
      `INSERT INTO product_images (product_inventory_sku, images, source, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (product_inventory_sku) DO UPDATE SET images = EXCLUDED.images, source = EXCLUDED.source,
         updated_by = EXCLUDED.updated_by, updated_at = now()`, [sku, JSON.stringify(images), source, staffId]);
    const snapshot = { sku, images, version: new Date().toISOString() };
    await this.events.publish(new ProductImagesSnapshot(snapshot), m);
    return snapshot;
  }

  /**
   * A SKU commerce has no gallery for yet starts from josh's image in the catalog copy (it keeps the first only). Every
   * gallery josh had is imported before the switch; a SKU created after it got at most the ERP's one image.
   */
  private async joshImages(m: EntityManager, sku: string): Promise<string[]> {
    const [row] = await m.query(`SELECT image_url FROM josh_catalog_products WHERE sku = $1 AND removed_at IS NULL AND image_url IS NOT NULL LIMIT 1`, [sku]);
    return row ? [row.image_url] : [];
  }

  private async isKnown(m: EntityManager, sku: string): Promise<boolean> {
    const [row] = await m.query(`SELECT 1 FROM product_images WHERE product_inventory_sku = $1
      UNION ALL SELECT 1 FROM josh_catalog_products WHERE sku = $1 AND removed_at IS NULL LIMIT 1`, [sku]);
    return !!row;
  }

  private async assertKnown(m: EntityManager, sku: string) {
    if (!(await this.isKnown(m, sku))) throw new NotFoundException(`ไม่พบสินค้า SKU ${sku}`);
  }

  private async findSku(name: string): Promise<string | null> {
    const [row] = await this.db.query(`SELECT product_inventory_sku AS sku FROM product_images WHERE lower(product_inventory_sku) = lower($1)
      UNION ALL SELECT sku FROM josh_catalog_products WHERE lower(sku) = lower($1) AND removed_at IS NULL LIMIT 1`, [name]);
    return row?.sku ?? null;
  }

  private assertFile(f: ImageFile) {
    if (f.size > MAX_BYTES) throw new BadRequestException(`${f.originalname}: ใหญ่เกิน 5 MB`);
    if (!IMAGE_EXT.test(f.originalname)) throw new BadRequestException(`${f.originalname}: รองรับ jpg / png / gif / webp`);
  }

  private assertOwned() {
    if (!ownsProductImages()) throw new ConflictException('รูปสินค้ายังแก้ที่ josh (COMMERCE_OWNS_PRODUCT_IMAGES is not true)');
  }
}

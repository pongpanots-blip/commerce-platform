import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { splitContent } from './content-fields';
import { ProductContentSnapshot } from './product-content-snapshot.event';

export const ownsProductContent = () => process.env.COMMERCE_OWNS_PRODUCT_CONTENT === 'true';

/**
 * Product content owned by commerce (stage 4b, COMMERCE_OWNS_PRODUCT_CONTENT): names / descriptions, ingredients,
 * cost … per SKU (content-fields.ts). Every change publishes product.content.snapshot with the whole row in the same
 * transaction, so josh's copy (the shop reads it) follows.
 */
@Injectable()
export class ProductContentsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}

  async get(sku: string) {
    const [row] = await this.db.query(`SELECT product_inventory_sku AS sku, fields, source, updated_by, updated_at FROM product_contents WHERE product_inventory_sku = $1`, [sku]);
    if (!row) throw new NotFoundException(`ไม่มีเนื้อหาสินค้า SKU ${sku} ใน commerce`);
    return row;
  }

  /** Staff edit (the product form) or a product created through commerce: content keys only, validated. */
  async edit(sku: string, body: Record<string, unknown>, staffId: string, source: 'staff' | 'create' = 'staff') {
    if (!ownsProductContent()) throw new ConflictException('เนื้อหาสินค้ายังแก้ที่ josh (COMMERCE_OWNS_PRODUCT_CONTENT is not true)');
    const { content, rest } = splitContent(body);
    if (Object.keys(rest).length) throw new BadRequestException(`ไม่ใช่เนื้อหาสินค้า: ${Object.keys(rest).join(', ')}`);
    if (!Object.keys(content).length) throw new BadRequestException('ไม่มีเนื้อหาให้แก้');
    return this.db.transaction(m => this.editWithin(m, sku, content, staffId, source));
  }

  /** Same native edit in an existing transaction, including its outbox event. */
  async editWithin(m: EntityManager, sku: string, body: Record<string, unknown>, staffId: string, source: 'staff' | 'create' = 'staff') {
      if (!ownsProductContent()) throw new ConflictException('เนื้อหาสินค้ายังแก้ที่ josh (COMMERCE_OWNS_PRODUCT_CONTENT is not true)');
      const { content, rest } = splitContent(body);
      if (Object.keys(rest).length) throw new BadRequestException(`ไม่ใช่เนื้อหาสินค้า: ${Object.keys(rest).join(', ')}`);
      if (!Object.keys(content).length) throw new BadRequestException('ไม่มีเนื้อหาให้แก้');
      // Every native caller, including create/product forms, shares the same
      // lock before its existence check and write with the reviewed editor.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`product-content:${sku}`]);
      // A product josh just created may not be in the catalog copy yet.
      const [known] = source === 'create' ? [true] : await m.query(`SELECT 1 FROM product_contents WHERE product_inventory_sku = $1
        UNION ALL SELECT 1 FROM josh_catalog_products WHERE sku = $1 LIMIT 1`, [sku]);
      if (!known) throw new NotFoundException(`ไม่พบสินค้า SKU ${sku}`);
      const [row]: Array<{ fields: Record<string, unknown> }> = await m.query(
        `INSERT INTO product_contents (product_inventory_sku, fields, source, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (product_inventory_sku) DO UPDATE SET fields = product_contents.fields || EXCLUDED.fields,
           source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING fields`, [sku, JSON.stringify(content), source, staffId]);
      const snapshot = { sku, fields: row.fields, version: new Date().toISOString() };
      await this.events.publish(new ProductContentSnapshot(snapshot), m);
      return snapshot;
  }
}

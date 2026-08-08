import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, ILike, In } from 'typeorm';
import { Product } from '../../modules/commerce/product/infrastructure/product.entity';
import { InventoryLevel } from '../../modules/commerce/inventory/infrastructure/inventory-level.entity';
import { PriceListItem } from '../../modules/commerce/price-list/infrastructure/price-list-item.entity';

export interface CatalogProductRow {
  id: string; sku: string; name: string; description: string | null; status: string;
  fulfillmentMode: string; leadTimeDays: number | null;
  price: string | null;   // 2-decimal string; display price only — never authority
  stock: number;          // cached availability; real availability decided at reserve time
}

/**
 * Read-only aggregation for the storefront catalog. Stock here is a CACHE for
 * display/UX — the reservation facade is the only availability authority.
 */
@Injectable()
export class StorefrontCatalogService {
  constructor(private readonly dataSource: DataSource) {}

  async list(params: { page: number; pageSize: number; search?: string }) {
    const where = params.search
      ? [{ name: ILike(`%${params.search}%`) }, { sku: ILike(`%${params.search}%`) }]
      : {};
    const [products, total] = await this.dataSource.getRepository(Product).findAndCount({
      where, order: { name: 'ASC' },
      skip: (params.page - 1) * params.pageSize, take: params.pageSize,
    });
    const items = await this.decorate(products);
    return { items, total, page: params.page, pageSize: params.pageSize };
  }

  async byId(id: string): Promise<CatalogProductRow> {
    const product = await this.dataSource.getRepository(Product).findOne({ where: { id } });
    if (!product) throw new NotFoundException(`product ${id} not found`);
    const [row] = await this.decorate([product]);
    return row;
  }

  private async decorate(products: Product[]): Promise<CatalogProductRow[]> {
    if (!products.length) return [];
    const ids = products.map((p) => p.id);
    const [levels, prices] = await Promise.all([
      this.dataSource.getRepository(InventoryLevel).find({ where: { productId: In(ids) } }),
      this.dataSource.getRepository(PriceListItem).find({
        where: { productId: In(ids) }, order: { createdAt: 'DESC' },
      }),
    ]);
    const stockByProduct = new Map<string, number>();
    for (const l of levels) {
      const free = Math.max(0, Number(l.quantity) - Number(l.reserved));
      stockByProduct.set(l.productId, (stockByProduct.get(l.productId) ?? 0) + free);
    }
    const priceByProduct = new Map<string, string>();
    for (const item of prices) {
      if (!priceByProduct.has(item.productId)) {
        priceByProduct.set(item.productId, Number(item.unitPrice).toFixed(2));
      }
    }
    return products.map((p) => ({
      id: p.id, sku: p.sku, name: p.name, description: p.description, status: p.status,
      fulfillmentMode: p.fulfillmentMode, leadTimeDays: p.leadTimeDays,
      price: priceByProduct.get(p.id) ?? null,
      stock: stockByProduct.get(p.id) ?? 0,
    }));
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ScrapingService } from '../../platform/scraping/application/scraping.service';
import { extractedWeightKg } from '../../platform/scraping/infrastructure/public-web.reader';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { InventoryShape } from './catalog-shape';
import { CompetitorMatchRejection, CompetitorMatchReview, CompetitorPrice } from './competitor-price.entity';
import { CompetitorPricesService, describeOurOffer, productView, rankSiteCandidates } from './competitor-prices.service';
import { compareAtOurPack, itemPackSize, ourPack, PackSize, packSizeText, toPackSize, unitLabel, type InputUnit } from './competitor-size';

// Ported from josh apps/backend/src/app/competitor-prices/competitor-review.service.ts (origin/main 8a44dd00) onto
// commerce's catalog copy: products come from CompetitorPricesService.activeProducts()/product() in josh's field names,
// and the SKU photo is the copy's image_url (josh read product_media).

const PAGE_SIZE = 20;
/** Proposals at or above this are pre-ticked; below, a person has to tick them. */
const SURE_PERCENT = 80;
export type TypedSize = { unit: InputUnit; min: number; max?: number | null; packCount?: number | null };

/**
 * The matching grid: our SKUs by category, 20 per batch, one cell per competitor site holding either the pair
 * already saved or the system's best proposal. Every tick saves at once; finishing a batch saves the proposals
 * still ticked and marks those SKUs reviewed, so a person can stop anywhere and continue later.
 */
@Injectable()
export class CompetitorReviewService {
  constructor(
    @InjectRepository(CompetitorPrice) private readonly prices: Repository<CompetitorPrice>,
    @InjectRepository(JoshCatalogProduct) private readonly products: Repository<JoshCatalogProduct>,
    @InjectRepository(CompetitorMatchRejection) private readonly rejections: Repository<CompetitorMatchRejection>,
    @InjectRepository(CompetitorMatchReview) private readonly reviews: Repository<CompetitorMatchReview>,
    private readonly competitor: CompetitorPricesService,
    private readonly scraping: ScrapingService,
  ) {}

  private category(product: InventoryShape) {
    return product.productCategory?.category_name_th || product.productCategory?.category_name_en || 'ไม่ระบุหมวด';
  }

  async grid(query: { category?: string; show?: 'todo' | 'done'; page?: number }) {
    const [products, reviewed, sources] = await Promise.all([
      this.competitor.activeProducts(),
      this.reviews.find({ select: { productId: true } }),
      this.scraping.listSources(),
    ]);
    const done = new Set(reviewed.map(r => r.productId));
    const byCategory = new Map<string, { total: number; reviewed: number }>();
    for (const p of products) {
      const c = byCategory.get(this.category(p)) ?? { total: 0, reviewed: 0 };
      c.total += 1; if (done.has(p.product_inventory_id)) c.reviewed += 1;
      byCategory.set(this.category(p), c);
    }
    const categories = [...byCategory.entries()].map(([name, c]) => ({ name, ...c })).sort((a, b) => a.name.localeCompare(b.name, 'th'));
    const category = query.category && byCategory.has(query.category) ? query.category : categories[0]?.name ?? '';
    const show = query.show === 'done' ? 'done' : 'todo';
    const inCategory = products.filter(p => this.category(p) === category);
    const list = inCategory.filter(p => done.has(p.product_inventory_id) === (show === 'done'))
      .sort((a, b) => a.product_inventory_sku.localeCompare(b.product_inventory_sku));
    const page = Math.max(1, query.page ?? 1);
    const batch = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const sites = [...new Set(sources.map(s => s.name))].sort((a, b) => a.localeCompare(b));
    return {
      categories, category, show, page, pageSize: PAGE_SIZE, total: list.length,
      counts: { total: inCategory.length, reviewed: inCategory.filter(p => done.has(p.product_inventory_id)).length },
      sites, rows: await this.rows(batch, sites),
    };
  }

  private async rows(batch: InventoryShape[], sites: string[]) {
    if (!batch.length) return [];
    const ids = batch.map(p => p.product_inventory_id);
    const [pairs, rejected, index] = await Promise.all([
      this.prices.find({ where: { productId: In(ids) }, relations: ['scrapingSource'] }),
      this.rejections.find({ where: { productId: In(ids) } }),
      this.competitor.matchIndex(),
    ]);
    // ponytail: linear scan of the index per paired cell (~40 per batch over ≤100k items); a url map if batches grow.
    const imageOf = (url: string) => index.items.find(item => item.url === url)?.image ?? null;
    return batch.map(product => {
      const offer = describeOurOffer(product);
      const our = ourPack(product, offer.pricePerKgIncVat);
      const own = pairs.filter(pair => pair.productId === product.product_inventory_id);
      const skip = new Set([...own.map(pair => pair.sourceUrl), ...rejected.filter(r => r.productId === product.product_inventory_id).map(r => r.sourceUrl)]);
      const names = product.translations?.map(t => t.product_name).filter(Boolean) ?? [];
      const proposals = rankSiteCandidates(names, product.selling_unit, extractedWeightKg(product.weight_per_unit || ''), our.rate, index, skip, 1);
      const cells = sites.map(site => {
        const paired = own.filter(pair => pair.scrapingSource?.name === site);
        if (paired.length) {
          const sized = paired.map(pair => {
            const size: PackSize = pair.competitorQtyMin != null
              ? { unit: pair.competitorUnit, min: Number(pair.competitorQtyMin), max: Number(pair.competitorQtyMax ?? pair.competitorQtyMin), packCount: pair.competitorPackCount }
              : { unit: pair.competitorUnit, min: Number(pair.competitorWeightKg), max: Number(pair.competitorWeightKg), packCount: 1 };
            return { pair, size, compare: compareAtOurPack(our, pair.priceIncVat == null ? null : Number(pair.priceIncVat), size) };
          }).sort((a, b) => (a.compare.differencePercent ?? Infinity) - (b.compare.differencePercent ?? Infinity));
          const best = sized[0];
          return { site, state: 'paired' as const, checked: true, pairId: best.pair.id, itemId: null, title: best.pair.competitorName, url: best.pair.sourceUrl,
            image: imageOf(best.pair.sourceUrl), size: this.sizeView(best.size), ...best.compare, confidencePercent: null,
            // Several packs of the same product on one site: the cell shows the cheapest per unit.
            moreSizes: paired.length - 1 };
        }
        const candidate = proposals.find(p => p.sourceName === site)?.candidates[0];
        if (!candidate) return { site, state: 'none' as const, checked: false };
        const size = itemPackSize(candidate.name, candidate.weightKg);
        const confidence = Math.min(100, candidate.similarityPercent + (candidate.weightMatch === 'same' ? 20 : candidate.weightMatch === 'per_kg' ? 10 : 0));
        return { site, state: 'proposed' as const, checked: confidence >= SURE_PERCENT && !!size, pairId: null, itemId: candidate.id,
          title: candidate.name, url: candidate.url, image: candidate.image, size: size ? this.sizeView(size) : null,
          ...compareAtOurPack(our, candidate.priceIncVat, size), confidencePercent: confidence, moreSizes: 0 };
      });
      return { sku: product.product_inventory_sku, name: productView(product).name,
        image: product.image_url, offerSummary: offer.summary, approx: offer.pricingType === 'approx',
        ourUnit: our.unit, ourUnitLabel: unitLabel[our.unit], ourPricePerUnit: our.rate, cells };
    });
  }

  private sizeView(size: PackSize) {
    return { ...size, text: packSizeText(size), unitLabel: unitLabel[size.unit] };
  }

  private async rowFor(sku: string) {
    const product = await this.competitor.product(sku);
    const sites = [...new Set((await this.scraping.listSources()).map(s => s.name))].sort((a, b) => a.localeCompare(b));
    return (await this.rows([product], sites))[0];
  }

  private async reject(productId: string, sourceUrl: string, actor: string) {
    await this.rejections.createQueryBuilder().insert().values({ productId, sourceUrl, createdBy: actor }).orIgnore().execute();
  }

  /**
   * One cell, saved at once. on + itemId: pair it (optionally with a typed size); on + pairId + size: re-pair with
   * the new size; off: remove the pair / proposal and remember "not this one". Returns the SKU's fresh row.
   */
  async setCell(actor: string, dto: { sku: string; on: boolean; itemId?: string; pairId?: string; size?: TypedSize }) {
    const product = await this.competitor.product(dto.sku);
    const size = dto.size ? toPackSize(dto.size) : undefined;
    if (size && !(size.min > 0)) throw new BadRequestException('ขนาดแพ็กต้องมากกว่า 0');
    if (dto.pairId) {
      const pair = await this.prices.findOne({ where: { id: dto.pairId, productId: product.product_inventory_id } });
      if (!pair) throw new NotFoundException('ไม่พบคู่สินค้า');
      if (dto.on && !size) return this.rowFor(dto.sku);
      const item = dto.on && pair.scrapingSourceId ? await this.scraping.itemByUrl(pair.scrapingSourceId, pair.sourceUrl) : null;
      if (dto.on && !item) throw new BadRequestException('คู่นี้กรอกเอง แก้ขนาดได้ที่หน้าผลเทียบราคา');
      if (dto.on && item && size) await this.competitor.replacePack(pair.id, product.product_inventory_id, size, pair.revision, actor);
      else await this.prices.manager.transaction(async manager => {
        await manager.getRepository(CompetitorMatchRejection).createQueryBuilder().insert().values({ productId: product.product_inventory_id, sourceUrl: pair.sourceUrl, createdBy: actor }).orIgnore().execute();
        const removed = await manager.getRepository(CompetitorPrice).delete({ id: pair.id, revision: pair.revision });
        if (removed.affected !== 1) throw new ConflictException('คู่สินค้าเปลี่ยนไปแล้ว อ่านข้อมูลใหม่ก่อนทำรายการ');
      });
      return this.rowFor(dto.sku);
    }
    if (!dto.itemId) throw new BadRequestException('ระบุสินค้าคู่แข่ง');
    const item = await this.scraping.item(dto.itemId);
    if (dto.on) {
      await this.competitor.match(item.id, dto.sku, actor, size);
      await this.rejections.delete({ productId: product.product_inventory_id, sourceUrl: item.url });
    } else {
      await this.reject(product.product_inventory_id, item.url, actor);
    }
    return this.rowFor(dto.sku);
  }

  /** Finish a batch: pair every proposal still ticked, then mark those SKUs reviewed. Failures are listed, not fatal. */
  async finish(actor: string, dto: { skus: string[]; accept: { sku: string; itemId: string }[] }) {
    const failed: { sku: string; itemId: string; message: string }[] = [];
    let saved = 0;
    for (const accept of dto.accept) {
      try { await this.competitor.match(accept.itemId, accept.sku, actor); saved += 1; }
      catch (error) {
        const duplicate = (error as { code?: string }).code === '23505';
        if (!duplicate) failed.push({ ...accept, message: error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ' });
      }
    }
    const failedSkus = new Set(failed.map(f => f.sku));
    const reviewedSkus = dto.skus.filter(sku => !failedSkus.has(sku));
    const products = reviewedSkus.length ? await this.products.find({ where: { sku: In(reviewedSkus) }, select: { id: true } }) : [];
    if (products.length) {
      await this.reviews.upsert(products.map(p => ({ productId: p.id, reviewedBy: actor, reviewedAt: new Date() })), ['productId']);
    }
    return { saved, reviewed: products.length, failed };
  }

  /** "ค้นหาเอง": search what we already collected from one site (never the live site). */
  async search(site: string, text: string, sku: string) {
    const product = await this.competitor.product(sku);
    const our = ourPack(product, describeOurOffer(product).pricePerKgIncVat);
    const sources = (await this.scraping.listSources()).filter(s => s.name === site);
    if (!sources.length) throw new NotFoundException('ไม่พบเว็บนี้');
    const { items } = await this.scraping.listItems(sources[0].id, text.slice(0, 200), 1);
    return items.slice(0, 8).map(item => {
      const size = itemPackSize(item.name, item.weightKg);
      return { itemId: item.id, title: item.name, url: item.url, image: item.fields.image || null, size: size ? this.sizeView(size) : null,
        ...compareAtOurPack(our, item.priceIncVat, size) };
    });
  }
}

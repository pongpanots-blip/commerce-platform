import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { IsNull, Not, Repository } from 'typeorm';
import { cronConfig } from '../../../config/cron.config';
import { ScrapingService } from '../../platform/scraping/application/scraping.service';
import { extractedWeightKg, publicUrl, scrapingVersion, singlePrice } from '../../platform/scraping/infrastructure/public-web.reader';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { JoshCatalogSyncService } from '../connector/josh/josh-catalog-sync.service';
import { resolveCatalogOrderingPrice, resolvePackTotalQty } from '../connector/josh/jagota/pack-order-price.helper';
import { CompetitorPrice } from './competitor-price.entity';
import { CaptureCompetitorPriceDto, SaveCompetitorPriceDto } from './competitor-price.dto';
import { InventoryShape, roundMoney, toInventoryShape } from './catalog-shape';
import { PackSize, itemPackSize, ourPack, packQuantity, packSizeText, unitLabel } from './competitor-size';
import { ScheduledCron } from '../../../shared-kernel/infrastructure/scheduled-task';
export { extractedWeightKg } from '../../platform/scraping/infrastructure/public-web.reader';

/*
 * Ported from josh apps/backend/src/app/competitor-prices/competitor-prices.service.ts (origin/main 8a44dd00).
 * Functions take josh's field names (InventoryShape) so the bodies stay diffable against josh; the catalog is
 * commerce's copy (josh_catalog_products, fed by josh catalog.snapshot events).
 */

/** A pair with its product in josh's field names. */
export type Pair = Omit<CompetitorPrice, 'product'> & { product: InventoryShape };
const shaped = (row: CompetitorPrice): Pair => ({ ...row, product: toInventoryShape(row.product) });

const SOURCES: Record<string, string> = {
  'makro.pro': 'Makro PRO', 'www.makro.pro': 'Makro PRO',
  'bigc.co.th': 'Big C', 'www.bigc.co.th': 'Big C',
  'freshket.co': 'Freshket', 'www.freshket.co': 'Freshket',
};

export function competitorSource(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new BadRequestException('ลิงก์สินค้าไม่ถูกต้อง'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !SOURCES[parsed.hostname]) {
    throw new BadRequestException('ใช้ลิงก์ HTTPS ของ Makro PRO, Big C หรือ Freshket เท่านั้น');
  }
  if (parsed.pathname === '/') throw new BadRequestException('ใช้ลิงก์หน้าสินค้าโดยตรง ไม่ใช่หน้าแรกของร้าน');
  return SOURCES[parsed.hostname];
}

export function catalogFingerprint(product: InventoryShape): string {
  // Prices can change without invalidating the match; identity/pack changes require review.
  return createHash('sha256').update(JSON.stringify([
    product.product_inventory_sku, product.brand_code, product.brand_name,
    product.country_code_source, product.storage_temperature, product.packaging_type,
    product.pack_size, product.units_per_box, product.weight_per_unit,
    product.selling_unit, product.vat_type,
    product.translations?.map(t => [t.language_code, t.product_name, t.product_description, t.product_detail]).sort(),
  ])).digest('hex');
}

export function catalogPricePerKg(product: InventoryShape, ourWeightKg: number): number | null {
  const price = Number(product.selling_unit_price);
  const unit = product.selling_unit?.trim().toUpperCase();
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(ourWeightKg) || ourWeightKg <= 0) return null;
  if (unit === 'KG') return price;
  if (unit === 'G' || unit === 'GM') return price * 1000;
  // Confirmed weight is per selling unit, never per order unit or carton inferred from a name.
  if (unit && ['PC', 'PK', 'BX', 'CT', 'CS', 'CA', 'EA', 'BT', 'BG', 'PA', 'PT'].includes(unit)) return price / ourWeightKg;
  return null;
}

// Sizes and pack counts say nothing about what a product is; weight is compared separately.
export function comparableName(name: string) {
  return name.toLowerCase()
    .replace(/\d+(?:[.,]\d+)?\s*(?:กิโลกรัม|กก\.?|กรัม|ก\.|kg|gm|g|มล\.?|ml|ลิตร|ล\.|l|ชิ้น|pcs?|แพ็ค|pack)(?![a-z])/gi, ' ')
    .replace(/\bx\s*\d+\b|\d+\s*x\b/gi, ' ')
    // Thai vowels/tone marks are \p{M}; dropping them would merge different words.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Dice similarity on character bigrams (0–1). Works for Thai, which has no spaces between words. */
export function nameSimilarity(a: string, b: string) {
  const grams = (text: string) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i++) counts.set(text.slice(i, i + 2), (counts.get(text.slice(i, i + 2)) || 0) + 1);
    return counts;
  };
  const left = grams(comparableName(a)), right = grams(comparableName(b));
  let overlap = 0, total = 0;
  for (const [gram, count] of left) { overlap += Math.min(count, right.get(gram) || 0); total += count; }
  for (const count of right.values()) total += count;
  return total ? (2 * overlap) / total : 0;
}
export type SkuWeightMatch = 'same' | 'different' | 'unknown' | 'per_kg';
/** `per_kg`: we sell by the kilo, so any competitor pack compares per kg. `same`: within 5%. */
export function skuWeightMatch(sellingUnit: string | null | undefined, ourWeightKg: number | null, theirWeightKg: number | null): SkuWeightMatch {
  if (['KG', 'G', 'GM'].includes(sellingUnit?.trim().toUpperCase() || '')) return 'per_kg';
  if (ourWeightKg == null || theirWeightKg == null) return 'unknown';
  return Math.abs(ourWeightKg - theirWeightKg) <= theirWeightKg * 0.05 ? 'same' : 'different';
}

export type MatchableItem = { id: string; name: string; url: string; weightKg: number | null; priceIncVat: number | null; image: string | null;
  rawPrice?: string | null; sourceId: string; sourceName: string };
/** A candidate must be at least this close by name; lower let "We are Built to Maximize…" through at 25%. */
const MIN_CANDIDATE_SIMILARITY = 0.35;
const gramSet = (name: string) => {
  const text = comparableName(name);
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2));
  return grams;
};
/**
 * Collected items worth offering (a readable weight and some price), with an inverted bigram index so one SKU
 * only scores the items that share its letters instead of all ~100k.
 */
export function buildMatchIndex(all: MatchableItem[]) {
  // A missing size is fine — the review grid lets a person type it; an item with no price at all is not.
  const items = all.filter(item => item.priceIncVat != null || !!item.rawPrice?.trim());
  const grams = items.map(item => gramSet(item.name));
  const postings = new Map<string, number[]>();
  grams.forEach((set, index) => set.forEach(gram => { const list = postings.get(gram); if (list) list.push(index); else postings.set(gram, [index]); }));
  return { items, grams, postings };
}
export type MatchIndex = ReturnType<typeof buildMatchIndex>;
/**
 * One SKU → many sites: the top `perSite` items on each site close to any of our SKU's names, with price/kg and
 * where we stand, skipping items already paired with this SKU. Same name + weight scoring as suggestions().
 */
export function rankSiteCandidates(names: string[], sellingUnit: string | null | undefined, ourWeightKg: number | null, ourRate: number | null,
  index: MatchIndex, paired: Set<string>, perSite = 3) {
  const close = new Set<number>();
  for (const name of names) {
    const ours = gramSet(name);
    const shared = new Map<number, number>();
    ours.forEach(gram => index.postings.get(gram)?.forEach(i => shared.set(i, (shared.get(i) || 0) + 1)));
    // Cheap set-Dice prefilter, then the exact multiset score below.
    shared.forEach((count, i) => { if (2 * count / (ours.size + index.grams[i].size) >= MIN_CANDIDATE_SIMILARITY - 0.05) close.add(i); });
  }
  const sites = new Map<string, { sourceId: string; sourceName: string; candidates: ReturnType<typeof candidate>[] }>();
  function candidate(item: MatchableItem, similarity: number) {
    const weightMatch = skuWeightMatch(sellingUnit, ourWeightKg, item.weightKg);
    const theirRate = item.priceIncVat == null || !item.weightKg ? null : item.priceIncVat / item.weightKg;
    const differencePercent = theirRate == null || ourRate == null ? null : roundMoney((theirRate - ourRate) / theirRate * 100);
    return { id: item.id, name: item.name, url: item.url, image: item.image, weightKg: item.weightKg, priceIncVat: item.priceIncVat,
      priceText: item.priceIncVat == null ? item.rawPrice?.trim() || null : null,
      pricePerKgIncVat: theirRate == null ? null : roundMoney(theirRate), differencePercent,
      // Positive = their price/kg is higher = we are cheaper.
      verdict: differencePercent == null ? 'ยังเทียบราคาต่อกก.ไม่ได้' : differencePercent === 0 ? 'ราคาเท่ากับเรา'
        : `${differencePercent > 0 ? 'เราถูกกว่า' : 'เราแพงกว่า'} ${Math.abs(differencePercent)}%`,
      similarityPercent: Math.round(similarity * 100), weightMatch,
      score: similarity + (weightMatch === 'same' ? 0.2 : weightMatch === 'per_kg' ? 0.1 : 0) };
  }
  for (const i of close) {
    const item = index.items[i];
    if (paired.has(item.url)) continue;
    const similarity = Math.max(0, ...names.map(name => nameSimilarity(item.name, name)));
    if (similarity < MIN_CANDIDATE_SIMILARITY) continue;
    const site = sites.get(item.sourceId) ?? { sourceId: item.sourceId, sourceName: item.sourceName, candidates: [] };
    site.candidates.push(candidate(item, similarity));
    sites.set(item.sourceId, site);
  }
  return [...sites.values()].map(site => ({ ...site,
    candidates: site.candidates.sort((a, b) => b.score - a.score).slice(0, perSite).map(({ score: _score, ...rest }) => rest) }))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

const unitNames: Record<string, string> = { KG: 'กิโลกรัม', G: 'กรัม', GM: 'กรัม', L: 'ลิตร', CT: 'ลัง', CS: 'ลัง', CA: 'ลัง', BX: 'กล่อง',
  PK: 'แพ็ค', PA: 'แพ็ค', PC: 'ชิ้น', EA: 'ชิ้น', BT: 'ขวด', BG: 'ถุง', PT: 'ถาด', JR: 'กระปุก', CN: 'กระป๋อง' };
const unitName = (code: string) => code ? unitNames[code] ?? code : 'หน่วย';
const baht = (value: number) => `฿${value.toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
const kilos = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
type Range = { min: number; max: number };
const rangeText = (range: Range, format: (value: number) => string) => range.min === range.max ? format(range.min) : `${format(range.min)}–${format(range.max)}`;

/**
 * How our SKU is actually sold, in numbers and one Thai sentence, so a merchandiser never has to decode
 * selling_unit / pack_size / Approx: price per kg, what one order unit weighs (a range for Approx), and
 * what one order unit costs. Same price sources as the shop (selling_unit_price, resolveCatalogOrderingPrice).
 */
export function describeOurOffer(product: InventoryShape) {
  const approx = /^approx$/i.test(product.packaging_type?.trim() ?? '');
  const sellingUnit = product.selling_unit?.trim().toUpperCase() || '';
  const orderUnit = product.order_taking_unit?.trim().toUpperCase() || sellingUnit;
  const price = Number(product.selling_unit_price) || 0;
  const byWeight = ['KG', 'G', 'GM'].includes(sellingUnit);
  const pack = resolvePackTotalQty(product);
  const packWeightKg: Range | null = pack && pack.unit === 'KG' && pack.max > 0 ? { min: pack.min, max: pack.max } : null;
  let pricePerKgIncVat: Range | null = null;
  let orderUnitPriceIncVat: Range | null = null;
  if (price > 0 && byWeight) {
    const perKg = sellingUnit === 'KG' ? price : roundMoney(price * 1000);
    pricePerKgIncVat = { min: perKg, max: perKg };
    if (approx && packWeightKg) orderUnitPriceIncVat = { min: roundMoney(perKg * packWeightKg.min), max: roundMoney(perKg * packWeightKg.max) };
    else {
      const ordering = resolveCatalogOrderingPrice(product);
      if (ordering) orderUnitPriceIncVat = { min: ordering, max: ordering };
    }
  } else if (price > 0) {
    orderUnitPriceIncVat = { min: price, max: price };
    // A box of 5.4–22.5 kg at one box price is ฿/kg in a range: the heaviest box is the cheapest per kg.
    if (packWeightKg) pricePerKgIncVat = { min: roundMoney(price / packWeightKg.max), max: roundMoney(price / packWeightKg.min) };
  }
  const packUnit = byWeight ? orderUnit : sellingUnit;
  const variable = approx || (packWeightKg != null && packWeightKg.min !== packWeightKg.max);
  const parts = [
    byWeight ? `ขายต่อ${unitName(sellingUnit)}${orderUnit && orderUnit !== sellingUnit ? ` สั่งเป็น${unitName(orderUnit)}` : ''}` : `ขายเป็น${unitName(sellingUnit)}`,
    packWeightKg && packUnit !== 'KG' ? `1 ${unitName(packUnit)} ${variable ? '≈ ' : ''}${rangeText(packWeightKg, kilos)} กก.${approx ? ' (น้ำหนักไม่คงที่)' : ''}`
      : !byWeight ? (product.pack_size ? `ขนาด ${product.pack_size}` : 'ไม่ระบุน้ำหนัก') : null,
    pricePerKgIncVat ? `${rangeText(pricePerKgIncVat, baht)}/กก.` : null,
    // "ประมาณ" only when the price itself varies; an Approx item sold per pack at one pack price is exact.
    orderUnitPriceIncVat && packUnit !== 'KG' ? `${orderUnitPriceIncVat.min !== orderUnitPriceIncVat.max ? 'ประมาณ ' : ''}${rangeText(orderUnitPriceIncVat, baht)} ต่อ${unitName(packUnit)}` : null,
    price > 0 ? null : 'ยังไม่มีราคาในแค็ตตาล็อก',
  ].filter(Boolean);
  return { pricingType: (approx ? 'approx' : 'fixed') as 'approx' | 'fixed', sellingUnit, sellingUnitName: unitName(sellingUnit), orderUnit, orderUnitName: unitName(orderUnit),
    packSize: product.pack_size || null, packWeightKg, pricePerKgIncVat, orderUnitPriceIncVat, summary: parts.join(' · ') };
}

const freshForHours = (row: Pair) => row.scrapingSource ? Math.max(24, row.scrapingSource.config.intervalHours + 24) : 24;
const planningValidUntil = (row: Pair) => {
  const observed = row.observedAt?.getTime(), hours = freshForHours(row);
  if (observed == null || !Number.isFinite(observed) || !Number.isFinite(hours)) return null;
  const value = new Date(observed + hours * 3600000);
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
};
/** `no_data` = paired but not comparable yet (waiting for confirmation / price); `unmatched` = no competitor pair at all. */
export type OverviewPosition = 'we_cheaper' | 'we_pricier' | 'same' | 'no_data' | 'unmatched';
/** `matched` = every SKU that has at least one pair (any position except `unmatched`). */
export type OverviewFilters = { site?: string; category?: string; position?: OverviewPosition | 'matched'; search?: string; page?: number };
const OVERVIEW_PAGE_SIZE = 50;

export function productView(product: InventoryShape) {
  return {
    id: product.product_inventory_id, sku: product.product_inventory_sku,
    name: product.translations?.find(t => t.language_code === 'th')?.product_name
      ?? product.translations?.[0]?.product_name ?? product.product_inventory_sku,
    brand: product.brand_name, country: product.country_code_source,
    storage: product.storage_temperature, packSize: product.pack_size,
    sellingUnit: product.selling_unit, sellingUnitPriceIncVat: Number(product.selling_unit_price),
    updatedAt: product.updated_at, syncedAt: product.synced_at, removed: !!product.removed_at,
    // Additive planning evidence; the original fields and price semantics stay unchanged.
    weightPerUnit: product.weight_per_unit, unitsPerBox: product.units_per_box,
    packagingType: product.packaging_type, vatType: product.vat_type,
    originalPriceIncVat: product.selling_unit_price == null ? null : String(product.selling_unit_price),
  };
}

@Injectable()
export class CompetitorPricesService {
  private refreshing = false;

  constructor(
    @InjectRepository(CompetitorPrice) private readonly prices: Repository<CompetitorPrice>,
    @InjectRepository(JoshCatalogProduct) private readonly products: Repository<JoshCatalogProduct>,
    private readonly catalogSync: JoshCatalogSyncService,
    private readonly scraping: ScrapingService,
  ) {}

  /** Active SKUs of the catalog copy, in josh's field names. */
  async activeProducts() {
    return (await this.products.findBy({ status: 'active', removedAt: IsNull() })).map(toInventoryShape);
  }

  async product(sku: string, readOnlyCopy = false) {
    const code = sku.trim();
    if (readOnlyCopy) {
      const copies = await this.products.find({ where: { sku: code, status: 'active', removedAt: IsNull() }, take: 2 });
      if (!copies.length) throw new NotFoundException('SKU not found in the active catalog copy');
      if (copies.length !== 1) throw new ConflictException('SKU identity is ambiguous');
      return toInventoryShape(copies[0]);
    }
    const copy = await this.products.findOneBy({ sku: code, removedAt: IsNull() });
    if (copy) return toInventoryShape(copy);
    // Only where a josh replica is configured (dev); in prod the copy is kept current by catalog.snapshot events.
    let fresh: JoshCatalogProduct | null = null;
    if (this.catalogSync.configured) {
      try { fresh = await this.catalogSync.syncSku(code); } catch {
        throw new ServiceUnavailableException('ยังไม่มี SKU นี้ในสำเนาแค็ตตาล็อก และติดต่อฐานข้อมูล josh ไม่ได้ กรุณาลองใหม่ภายหลัง');
      }
    }
    if (!fresh || fresh.removedAt) throw new NotFoundException('ไม่พบ SKU นี้ในแค็ตตาล็อก Josh');
    return toInventoryShape(fresh);
  }

  catalogItem(id: string) { return this.scraping.item(id); }

  async catalog(sku: string, readOnlyCopy = false) { return productView(await this.product(sku, readOnlyCopy)); }

  /**
   * Top 3 active Josh SKUs for a collected competitor item: similar name (TH or EN), then matching weight.
   * A person still confirms the pair; nothing is matched automatically.
   * ponytail: scores every active SKU in Node (~2k rows) so Thai works regardless of DB locale; move to pg_trgm + index if the catalog grows 10×.
   */
  async suggestions(catalogItemId: string) {
    const item = await this.scraping.item(catalogItemId);
    const theirWeightKg = item.weightKg;
    const products = await this.activeProducts();
    const ranked = products.map(product => {
      const names = product.translations?.map(t => t.product_name).filter(Boolean) ?? [];
      const similarity = Math.max(0, ...names.map(name => nameSimilarity(item.name, name)));
      const ourWeightKg = extractedWeightKg(product.weight_per_unit || '');
      const weightMatch = skuWeightMatch(product.selling_unit, ourWeightKg, theirWeightKg);
      const score = similarity + (weightMatch === 'same' ? 0.2 : weightMatch === 'per_kg' ? 0.1 : 0);
      return { product, similarity, ourWeightKg, weightMatch, score };
    }).filter(row => row.similarity >= 0.2).sort((a, b) => b.score - a.score).slice(0, 3);
    return {
      catalogItem: { id: item.id, name: item.name, weightKg: theirWeightKg },
      suggestions: ranked.map(({ product, similarity, ourWeightKg, weightMatch }) => ({
        ...productView(product), similarityPercent: Math.round(similarity * 100), weightMatch,
        // What to put in "our weight" for this pair: per-kg SKUs compare at the competitor's pack weight.
        ourWeightKg: weightMatch === 'per_kg' ? theirWeightKg ?? 1 : ourWeightKg,
      })),
    };
  }

  private matchCache: { stamp: string; index: MatchIndex } | null = null;
  /** Per-instance cache of collected items, rebuilt only when scraped_items changed (count + last update). */
  async matchIndex() {
    const stamp = await this.scraping.itemsStamp();
    if (this.matchCache?.stamp !== stamp) this.matchCache = { stamp, index: buildMatchIndex(await this.scraping.matchableItems()) };
    return this.matchCache.index;
  }

  private async candidatesFor(product: InventoryShape, paired: Set<string>) {
    const offer = describeOurOffer(product);
    const ourRate = offer.pricePerKgIncVat && offer.pricePerKgIncVat.min === offer.pricePerKgIncVat.max ? offer.pricePerKgIncVat.min : null;
    const sites = rankSiteCandidates(product.translations?.map(t => t.product_name).filter(Boolean) ?? [], product.selling_unit,
      extractedWeightKg(product.weight_per_unit || ''), ourRate, await this.matchIndex(), paired);
    return { sku: product.product_inventory_sku, name: productView(product).name, offerSummary: offer.summary, ourPricePerKgIncVat: ourRate, sites };
  }

  /** The same SKU on the other sites: top 3 collected items per site, so one Josh SKU can be paired with every site. */
  async siteCandidates(sku: string, readOnlyCopy = false) {
    const product = await this.product(sku, readOnlyCopy);
    const paired = await this.prices.find({ where: { productId: product.product_inventory_id }, select: { id: true, sourceUrl: true } });
    return this.candidatesFor(product, new Set(paired.map(row => row.sourceUrl)));
  }

  /**
   * Matching queue: the next active SKU (by SKU code, after `after`) that has no competitor pair yet AND has at
   * least one close item on some site — SKUs nothing resembles are skipped. Scans at most 300 SKUs per call;
   * `item: null` with `done: false` means call again with `after = scannedTo`.
   */
  async matchQueue(after = '') {
    const [products, pairs] = await Promise.all([
      this.activeProducts(),
      this.prices.find({ select: { id: true, productId: true } }),
    ]);
    const pairedIds = new Set(pairs.map(pair => pair.productId));
    const unmatched = products.filter(p => !pairedIds.has(p.product_inventory_id)).sort((a, b) => a.product_inventory_sku.localeCompare(b.product_inventory_sku));
    const counts = { total: products.length, matched: products.length - unmatched.length, unmatched: unmatched.length };
    const start = unmatched.findIndex(p => p.product_inventory_sku.localeCompare(after) > 0);
    if (start < 0) return { item: null, scannedTo: after, done: true, counts };
    const end = Math.min(unmatched.length, start + 300);
    for (let i = start; i < end; i++) {
      const found = await this.candidatesFor(unmatched[i], new Set());
      if (found.sites.length) return { item: found, scannedTo: found.sku, done: false, counts };
    }
    return { item: null, scannedTo: unmatched[end - 1].product_inventory_sku, done: end >= unmatched.length, counts };
  }

  private fingerprint(row: Pair) {
    const product = catalogFingerprint(row.product);
    return row.scrapingSource ? createHash('sha256').update(product + scrapingVersion(row.scrapingSource.config)).digest('hex') : product;
  }

  private view(row: Pair) {
    const ourRate = catalogPricePerKg(row.product, Number(row.ourWeightKg));
    const unsupportedLegacyKgBasis = (row.competitorUnit ?? 'kg') !== 'kg' || row.competitorQtyMin != null && row.competitorQtyMax != null && Number(row.competitorQtyMin) !== Number(row.competitorQtyMax);
    const theirRate = unsupportedLegacyKgBasis || row.priceIncVat == null ? null : Number(row.priceIncVat) / Number(row.competitorWeightKg);
    const verified = !!row.verifiedFingerprint && row.verifiedFingerprint === this.fingerprint(row);
    const reason = row.product.removed_at ? 'สินค้านี้ไม่อยู่ในแค็ตตาล็อก Josh แล้ว'
      : !verified ? 'รอตรวจและยืนยันคู่สินค้า'
      : !row.vatIncluded ? 'ยังไม่ยืนยันว่าราคาคู่แข่งรวม VAT'
      : unsupportedLegacyKgBasis ? 'หน่วยหรือช่วงขนาดนี้ไม่ใช่ฐานราคาต่อกก. ตรวจฐานหน่วยในหน้าเทียบสินค้า'
      : row.captureMethod === 'automatic' && row.scrapingSource?.config.currency !== 'THB' ? 'สกุลเงินต่างกันหรือยังไม่ยืนยัน ไม่ใช้เทียบราคาบาท'
      : ourRate == null ? 'ตรวจหน่วยขายและราคาของเราในแค็ตตาล็อก'
      : theirRate == null ? 'ยังไม่มีราคาคู่แข่ง'
      : row.captureMethod === 'automatic' && (!row.scrapingSource || row.capturedSourceVersion !== scrapingVersion(row.scrapingSource.config)) ? 'ตั้งค่าตัวอ่านเว็บเปลี่ยน กรุณาดึงราคาใหม่'
      // A collected price stays usable for its source's own cycle + 1 day (daily run → 48 h); manual pairs 24 h.
      : row.observedAt && row.observedAt.getTime() > Date.now() ? 'เวลาที่พบราคาอยู่ในอนาคต'
      : !row.observedAt || !Number.isFinite(freshForHours(row)) || Date.now() - row.observedAt.getTime() > freshForHours(row) * 3600000 ? `ราคาเกินอายุข้อมูลหรือยังไม่ทราบอายุ กรุณาอัปเดต`
      : row.lastError ? 'ดึงครั้งล่าสุดไม่สำเร็จ กรุณาตรวจแหล่งที่มา' : null;
    const refreshReason = !row.scrapingSource ? 'ตั้งค่าเว็บต้นทาง แล้วบันทึกคู่สินค้านี้อีกครั้งเพื่อเปิดตัวดึงราคา'
      : unsupportedLegacyKgBasis ? 'ตัวรวบรวมเดิมรองรับน้ำหนักกก. คงที่เท่านั้น บันทึกราคาหน่วยอื่นด้วยตนเอง'
      : !row.scrapingSource.config.collectionAllowed ? 'เว็บต้นทางยังไม่ยืนยันสิทธิ์ดึงข้อมูล'
      : !row.scrapingSource.config.vatIncluded || row.scrapingSource.config.currency !== 'THB' ? 'ตั้งค่าฐานราคาเว็บเป็น THB รวม VAT ก่อนเทียบ'
      : !row.collectionAllowed ? 'ยังไม่ยืนยันสิทธิ์ดึงข้อมูลจากแหล่งนี้'
      : !row.vatIncluded ? 'กรุณายืนยันฐานราคาและ VAT ก่อนดึงราคา'
      : !verified ? 'กรุณายืนยันคู่สินค้าก่อนดึงราคา' : null;
    const gap = reason || ourRate == null || theirRate == null ? null : theirRate - ourRate;
    return {
      id: row.id, revision: row.revision, ourProduct: productView(row.product),
      ourProductVersion: this.fingerprint(row),
      ourWeightKg: Number(row.ourWeightKg), ourPricePerKgIncVat: ourRate == null ? null : roundMoney(ourRate),
      ourPackPriceIncVat: ourRate == null ? null : roundMoney(ourRate * Number(row.ourWeightKg)),
      sourceName: row.scrapingSource?.name ?? SOURCES[new URL(row.sourceUrl).hostname] ?? new URL(row.sourceUrl).hostname, sourceUrl: row.sourceUrl,
      competitorName: row.competitorName, competitorSku: row.competitorSku,
      competitorWeightKg: Number(row.competitorWeightKg), sourceContext: row.sourceContext,
      competitorPackPriceIncVat: row.priceIncVat == null ? null : Number(row.priceIncVat),
      competitorPricePerKgIncVat: theirRate == null ? null : roundMoney(theirRate),
      differencePerKgIncVat: gap == null ? null : roundMoney(gap),
      differenceForOurWeightIncVat: gap == null ? null : roundMoney(gap * Number(row.ourWeightKg)),
      differencePercent: gap == null || theirRate == null ? null : roundMoney(gap / theirRate * 100),
      comparisonReady: reason == null, comparisonReason: reason, verified,
      // Read while logged in to our member account on that site → member price, never mixed with public prices.
      priceBasis: (row.scrapingSource?.loginUsername ? 'member' : 'public') as 'public' | 'member',
      matchNote: row.matchNote, verifiedAt: row.verifiedAt, verifiedBy: row.verifiedBy,
      vatIncluded: row.vatIncluded, collectionAllowed: row.collectionAllowed, autoRefresh: row.autoRefresh,
      canRefresh: refreshReason == null, refreshReason, observedAt: row.observedAt,
      captureMethod: row.captureMethod, lastError: row.lastError,
      // Original decimal values and dimensions, before legacy floating-point display normalization.
      planningEvidence: {
        originalPriceIncVat: row.priceIncVat == null ? null : String(row.priceIncVat),
        unit: row.competitorUnit ?? 'kg',
        min: row.competitorQtyMin == null ? (row.competitorUnit ?? 'kg') === 'kg' ? String(row.competitorWeightKg) : null : String(row.competitorQtyMin),
        max: row.competitorQtyMax == null ? row.competitorQtyMin == null ? (row.competitorUnit ?? 'kg') === 'kg' ? String(row.competitorWeightKg) : null : String(row.competitorQtyMin) : String(row.competitorQtyMax),
        count: row.competitorQtyMin == null ? 1 : row.competitorPackCount,
        // The existing manual capture UI/contract explicitly records baht inclusive of VAT.
        currency: row.captureMethod === 'manual' ? 'THB' : row.captureMethod === 'automatic' ? row.scrapingSource?.config.currency ?? null : null,
        taxIncluded: row.vatIncluded && (row.captureMethod !== 'automatic' || !!row.scrapingSource?.config.vatIncluded),
        sourceCurrent: row.captureMethod !== 'automatic' || !!row.scrapingSource && row.capturedSourceVersion === scrapingVersion(row.scrapingSource.config),
        validUntil: planningValidUntil(row),
      },
    };
  }

  /**
   * Merchandiser view: one row per Josh SKU — every active SKU, paired or not (`unmatched`). `cheapest` is the lowest price/kg among
   * comparison-ready pairs only (verified, VAT confirmed, fresh price), so a stale or unconfirmed price never
   * becomes the negotiation number. `position` is the decision: are we cheaper or pricier than that.
   */
  async overview(filters: OverviewFilters = {}) {
    const [rows, products, sources] = await Promise.all([
      this.prices.find({ relations: ['product', 'scrapingSource'] }).then(rows => rows.map(shaped)),
      this.activeProducts(),
      this.scraping.listSources(),
    ]);
    const bySku = new Map<string, { product: InventoryShape; views: ReturnType<CompetitorPricesService['view']>[] }>();
    for (const row of rows) {
      const group = bySku.get(row.productId) ?? { product: row.product, views: [] };
      group.views.push(this.view(row));
      bySku.set(row.productId, group);
    }
    // Every active SKU gets a row, so a merchandiser sees what still has no competitor to compare with.
    for (const product of products) if (!bySku.has(product.product_inventory_id)) bySku.set(product.product_inventory_id, { product, views: [] });
    const all = [...bySku.values()].map(({ product, views }) => {
      const ready = views.filter(v => v.comparisonReady && v.competitorPricePerKgIncVat != null)
        .sort((a, b) => a.competitorPricePerKgIncVat! - b.competitorPricePerKgIncVat!);
      // `position` uses public prices only; member prices get their own column so the two are never mixed.
      const cheapest = ready.find(v => v.priceBasis === 'public') ?? null;
      const member = ready.find(v => v.priceBasis === 'member') ?? null;
      const ourOffer = describeOurOffer(product);
      const offerRate = ourOffer.pricePerKgIncVat?.min === ourOffer.pricePerKgIncVat?.max ? ourOffer.pricePerKgIncVat?.min ?? null : null;
      const ourPricePerKgIncVat = cheapest?.ourPricePerKgIncVat ?? views.find(v => v.ourPricePerKgIncVat != null)?.ourPricePerKgIncVat ?? offerRate;
      const difference = cheapest && ourPricePerKgIncVat != null ? roundMoney(cheapest.competitorPricePerKgIncVat! - ourPricePerKgIncVat) : null;
      const position: OverviewPosition = !views.length ? 'unmatched' : difference == null ? 'no_data' : difference > 0 ? 'we_cheaper' : difference < 0 ? 'we_pricier' : 'same';
      const pending = views.length - ready.length;
      // The one sentence a merchandiser reads first: where we stand, against whom, on the same per-kg basis.
      const verdict = cheapest && ourPricePerKgIncVat != null
        ? `${{ we_cheaper: 'เราถูกกว่า', we_pricier: 'เราแพงกว่า', same: 'ราคาเท่ากับ', no_data: '', unmatched: '' }[position]} ${cheapest.sourceName}`
          + `${position === 'same' ? '' : ` ${Math.abs(roundMoney(difference! / cheapest.competitorPricePerKgIncVat! * 100))}%`}`
          + ` · เรา ${baht(ourPricePerKgIncVat)}/กก. vs ${baht(cheapest.competitorPricePerKgIncVat!)}/กก.${ourOffer.pricingType === 'approx' ? ' · ราคาเราคิดตามน้ำหนักจริง' : ''}`
        : !views.length ? 'ยังไม่ได้จับคู่กับเว็บคู่แข่ง'
        : pending ? `ยังเทียบไม่ได้ — ${views.find(v => !v.comparisonReady)?.comparisonReason ?? 'ตรวจคู่สินค้า'}` : 'ยังไม่มีราคาคู่แข่งที่เทียบได้';
      // Every site this SKU is compared with, cheapest comparable first, each in plain words.
      const comparisons = [...views].sort((a, b) => Number(b.comparisonReady) - Number(a.comparisonReady)
        || (a.competitorPricePerKgIncVat ?? Infinity) - (b.competitorPricePerKgIncVat ?? Infinity)).map(v => {
        const gap = v.comparisonReady && v.differencePercent != null ? v.differencePercent : null;
        return {
          pairId: v.id, sourceName: v.sourceName, competitorName: v.competitorName, sourceUrl: v.sourceUrl, priceBasis: v.priceBasis,
          pricePerKgIncVat: v.comparisonReady ? v.competitorPricePerKgIncVat : null, observedAt: v.observedAt, comparable: v.comparisonReady,
          position: (gap == null ? 'no_data' : gap > 0 ? 'we_cheaper' : gap < 0 ? 'we_pricier' : 'same') as OverviewPosition,
          differencePercent: gap,
          // "฿86 ต่อแพ็ค 1 กก. = ฿86/กก." then where we stand against this site.
          summary: `${v.competitorPackPriceIncVat == null ? '' : `${baht(v.competitorPackPriceIncVat)} ต่อแพ็ค `}${kilos(v.competitorWeightKg)} กก.${v.competitorPricePerKgIncVat == null ? '' : ` = ${baht(v.competitorPricePerKgIncVat)}/กก.`}`,
          verdict: gap == null ? `ยังเทียบไม่ได้ — ${v.comparisonReason ?? 'ตรวจคู่สินค้า'}`
            : gap === 0 ? 'ราคาเท่ากับเรา' : `${gap > 0 ? 'เราถูกกว่า' : 'เราแพงกว่า'} ${Math.abs(gap)}% (${gap > 0 ? '' : '+'}${baht(Math.abs(v.differencePerKgIncVat ?? 0))}/กก.)`,
        };
      });
      return {
        sku: product.product_inventory_sku, name: productView(product).name, ourOffer, verdict, comparisons,

        category: product.productCategory?.category_name_th || product.productCategory?.category_name_en || '',
        sellingUnit: product.selling_unit, ourPricePerKgIncVat,
        cheapest: cheapest && { pairId: cheapest.id, sourceName: cheapest.sourceName, competitorName: cheapest.competitorName, sourceUrl: cheapest.sourceUrl,
          pricePerKgIncVat: cheapest.competitorPricePerKgIncVat!, packPriceIncVat: cheapest.competitorPackPriceIncVat, weightKg: cheapest.competitorWeightKg, observedAt: cheapest.observedAt,
          summary: `${cheapest.competitorPackPriceIncVat == null ? '' : `${baht(cheapest.competitorPackPriceIncVat)} ต่อแพ็ค `}${kilos(cheapest.competitorWeightKg)} กก. = ${baht(cheapest.competitorPricePerKgIncVat!)}/กก.` },
        cheapestMember: member && ourPricePerKgIncVat != null ? { pairId: member.id, sourceName: member.sourceName, competitorName: member.competitorName,
          sourceUrl: member.sourceUrl, pricePerKgIncVat: member.competitorPricePerKgIncVat!, observedAt: member.observedAt,
          differencePercent: roundMoney((member.competitorPricePerKgIncVat! - ourPricePerKgIncVat) / member.competitorPricePerKgIncVat! * 100) } : null,
        // Positive = competitor dearer = we are cheaper.
        differencePerKgIncVat: difference,
        differencePercent: difference == null ? null : roundMoney(difference / cheapest!.competitorPricePerKgIncVat! * 100),
        position,
        sites: [...new Set(views.map(v => v.sourceName))], readyPairs: ready.length, pendingPairs: pending,
        pairs: views,
      };
    });
    const search = filters.search?.trim().toLowerCase();
    const scoped = all.filter(row => (!filters.site || row.sites.includes(filters.site)) && (!filters.category || row.category === filters.category)
      && (!search || `${row.sku} ${row.name}`.toLowerCase().includes(search)));
    // Biggest "we are pricier" gap first — that is what to raise with suppliers; then waiting to confirm; unmatched last.
    const rank = (row: { position: OverviewPosition }) => row.position === 'unmatched' ? 2 : row.position === 'no_data' ? 1 : 0;
    const rowsOut = scoped.filter(row => !filters.position || (filters.position === 'matched' ? row.position !== 'unmatched' : row.position === filters.position))
      .sort((a, b) => rank(a) - rank(b) || (a.differencePercent ?? Infinity) - (b.differencePercent ?? Infinity) || a.sku.localeCompare(b.sku));
    const count = (position: OverviewPosition) => scoped.filter(r => r.position === position).length;
    return {
      // No `page` (Excel export) → every row.
      rows: filters.page ? rowsOut.slice((filters.page - 1) * OVERVIEW_PAGE_SIZE, filters.page * OVERVIEW_PAGE_SIZE) : rowsOut,
      total: rowsOut.length, page: filters.page ?? 1, pageSize: filters.page ? OVERVIEW_PAGE_SIZE : rowsOut.length,
      // Column per site: sites already paired plus every configured site.
      sites: [...new Set([...all.flatMap(row => row.sites), ...sources.map(source => source.name)])].sort(),
      categories: [...new Set(all.map(row => row.category).filter(Boolean))].sort(),
      // Counts ignore the position filter so the tabs keep their numbers while one is selected.
      totals: { skus: scoped.length, weCheaper: count('we_cheaper'), wePricier: count('we_pricier'), same: count('same'), noData: count('no_data'), unmatched: count('unmatched') },
    };
  }

  /** Same rows and filters as overview(), as .xlsx: sheet 1 one row per SKU, sheet 2 every competitor pair. */
  async overviewXlsx(filters: OverviewFilters = {}) {
    const { rows } = await this.overview({ ...filters, page: undefined });
    const ExcelJS = await import('exceljs');
    const workbook = new ((ExcelJS as unknown as { default?: typeof ExcelJS }).default ?? ExcelJS).Workbook();
    const positionText: Record<OverviewPosition, string> = { we_cheaper: 'เราถูกกว่า', we_pricier: 'เราแพงกว่า', same: 'เท่ากัน', no_data: 'รอยืนยัน / ยังไม่มีราคา', unmatched: 'ยังไม่จับคู่' };
    const summary = workbook.addWorksheet('สรุปราย SKU');
    summary.columns = [
      { header: 'SKU', key: 'sku', width: 18 }, { header: 'สินค้าเรา', key: 'name', width: 40 }, { header: 'หมวด', key: 'category', width: 18 },
      { header: 'สรุปผลเทียบ', key: 'verdict', width: 50 },
      { header: 'ประเภทราคา', key: 'pricingType', width: 10 }, { header: 'สินค้าเราขายอย่างไร', key: 'offer', width: 60 },
      { header: 'น้ำหนักต่อหน่วยสั่ง (กก.)', key: 'packKg', width: 14 }, { header: 'ราคาต่อหน่วยสั่ง (รวม VAT)', key: 'orderPrice', width: 18 },
      { header: 'ราคาเรา/กก. (รวม VAT)', key: 'ours', width: 14 }, { header: 'สถานะ', key: 'position', width: 14 },
      { header: 'ส่วนต่าง/กก. (บาท)', key: 'diff', width: 14 }, { header: 'ส่วนต่าง %', key: 'pct', width: 10 },
      { header: 'คู่แข่งที่ถูกสุด', key: 'site', width: 18 }, { header: 'สินค้าคู่แข่ง', key: 'theirName', width: 40 },
      { header: 'ราคาคู่แข่ง/กก.', key: 'theirs', width: 14 }, { header: 'ราคาคู่แข่ง/แพ็ก', key: 'pack', width: 14 }, { header: 'น้ำหนักแพ็ก (กก.)', key: 'kg', width: 12 },
      { header: 'เห็นราคาเมื่อ', key: 'seen', width: 18 }, { header: 'ลิงก์', key: 'url', width: 50 }, { header: 'คู่ที่รอยืนยัน', key: 'pending', width: 12 },
      { header: 'ราคาสมาชิกถูกสุด (เว็บ)', key: 'memberSite', width: 18 }, { header: 'ราคาสมาชิก/กก.', key: 'member', width: 14 }, { header: 'ส่วนต่างราคาสมาชิก %', key: 'memberPct', width: 12 },
    ];
    const range = (r: Range | null, format: (n: number) => string) => r ? rangeText(r, format) : '';
    for (const row of rows) summary.addRow({ sku: row.sku, name: row.name, category: row.category, verdict: row.verdict,
      pricingType: row.ourOffer.pricingType === 'approx' ? 'Approx' : 'Fixed', offer: row.ourOffer.summary,
      packKg: range(row.ourOffer.packWeightKg, kilos), orderPrice: range(row.ourOffer.orderUnitPriceIncVat, baht),
      ours: row.ourPricePerKgIncVat, position: positionText[row.position],
      diff: row.differencePerKgIncVat, pct: row.differencePercent, site: row.cheapest?.sourceName, theirName: row.cheapest?.competitorName,
      theirs: row.cheapest?.pricePerKgIncVat, pack: row.cheapest?.packPriceIncVat, kg: row.cheapest?.weightKg, seen: row.cheapest?.observedAt ?? null,
      url: row.cheapest?.sourceUrl, pending: row.pendingPairs, memberSite: row.cheapestMember?.sourceName, member: row.cheapestMember?.pricePerKgIncVat,
      memberPct: row.cheapestMember?.differencePercent });
    const pairs = workbook.addWorksheet('ทุกคู่เทียบ');
    pairs.columns = [
      { header: 'SKU', key: 'sku', width: 18 }, { header: 'สินค้าเรา', key: 'name', width: 40 }, { header: 'เว็บ', key: 'site', width: 18 },
      { header: 'สินค้าคู่แข่ง', key: 'theirName', width: 40 }, { header: 'ราคาเรา/กก.', key: 'ours', width: 12 }, { header: 'ราคาคู่แข่ง/กก.', key: 'theirs', width: 12 },
      { header: 'ส่วนต่าง %', key: 'pct', width: 10 }, { header: 'ฐานราคา', key: 'basis', width: 10 }, { header: 'พร้อมเทียบ', key: 'ready', width: 10 }, { header: 'เหตุผลที่ยังเทียบไม่ได้', key: 'reason', width: 30 },
      { header: 'เห็นราคาเมื่อ', key: 'seen', width: 18 }, { header: 'ลิงก์', key: 'url', width: 50 },
    ];
    for (const row of rows) for (const pair of row.pairs) pairs.addRow({ sku: row.sku, name: row.name, site: pair.sourceName, theirName: pair.competitorName,
      ours: pair.ourPricePerKgIncVat, theirs: pair.competitorPricePerKgIncVat, pct: pair.differencePercent, basis: pair.priceBasis === 'member' ? 'สมาชิก' : 'สาธารณะ', ready: pair.comparisonReady ? 'ใช่' : 'ไม่',
      reason: pair.comparisonReason ?? '', seen: pair.observedAt, url: pair.sourceUrl });
    for (const sheet of [summary, pairs]) { sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]; }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async list(sku?: string) {
    const rows = (await this.prices.find({ ...(sku ? { where: { product: { sku } } } : {}), relations: ['product', 'scrapingSource'], order: { createdAt: 'DESC' } })).map(shaped);
    return rows.map(row => this.view(row));
  }

  private async read(id: string) {
    const row = await this.prices.findOne({ where: { id }, relations: ['product', 'scrapingSource'] });
    if (!row) throw new NotFoundException('ไม่พบคู่สินค้า');
    return shaped(row);
  }

  private async change(id: string, mutate: (row: CompetitorPrice) => void, revision?: number) {
    await this.prices.manager.transaction(async manager => {
      const repository = manager.getRepository(CompetitorPrice);
      const row = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new NotFoundException('ไม่พบคู่สินค้า');
      if (revision != null && row.revision !== revision) throw new BadRequestException('ข้อมูลเปลี่ยนระหว่างทำรายการ กรุณาโหลดใหม่');
      mutate(row);
      await repository.save(row);
    });
    return this.view(await this.read(id));
  }

  /** Compatibility path: replace typed dimensions in place; never delete a pair before recreating it. */
  async replacePack(id: string, productId: string, size: PackSize, revision: number, actor: string) {
    await this.prices.manager.transaction(async manager => {
      const repository = manager.getRepository(CompetitorPrice);
      const row = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row || row.productId !== productId) throw new NotFoundException('Pair unavailable');
      if (row.revision !== revision) throw new ConflictException('Pair changed. Reload before replacing its pack.');
      const before = JSON.parse(JSON.stringify(row));
      row.competitorUnit = size.unit; row.competitorQtyMin = size.min; row.competitorQtyMax = size.max;
      row.competitorPackCount = size.packCount; row.competitorWeightKg = size.min * size.packCount;
      row.verifiedFingerprint = null; row.verifiedBy = null; row.verifiedAt = null;
      row.priceIncVat = null;
      row.matchNote = 'Uncertain: Pack changed; review the match and record a price for this pack.';
      const saved = await repository.save(row);
      // The original observation and dimensions stay archived atomically with the replacement.
      await manager.query(`INSERT INTO commerce_promotion_drafts(id,actor_id,revision,scenario,evidence,preview)
        VALUES(gen_random_uuid(),$1,1,$2,$3,$4)`, [actor, JSON.stringify({kind:'competitor_legacy_archive',pairId:id}),JSON.stringify(before),JSON.stringify(saved)]);
    });
    return this.view(await this.read(id));
  }

  async save(dto: SaveCompetitorPriceDto, id?: string) {
    const sourceUrl = publicUrl(dto.sourceUrl).href;
    const source = await this.scraping.findOrigin(sourceUrl);
    if (!source) competitorSource(sourceUrl);
    if (sourceUrl.length > 2000) throw new BadRequestException('ลิงก์สินค้ายาวเกินไป กรุณาใช้ลิงก์สินค้าโดยตรง');
    if (![dto.sku, dto.competitorName, dto.sourceContext].every(value => value.trim())) throw new BadRequestException('กรอก SKU ชื่อสินค้า และเงื่อนไขราคา');
    if (dto.autoRefresh && (!dto.collectionAllowed || !dto.vatIncluded)) throw new BadRequestException('ดึงอัตโนมัติต้องยืนยันสิทธิ์ดึงข้อมูลและราคาที่รวม VAT');
    const product = await this.product(dto.sku);
    const imported = dto.catalogItemId ? await this.scraping.item(dto.catalogItemId) : null;
    if (imported && (!imported.configCurrent || imported.url !== sourceUrl || imported.name !== dto.competitorName.trim()
      || imported.sku !== (dto.competitorSku?.trim() || '') || imported.sourceId !== source?.id
      || (imported.weightKg != null && Math.abs(imported.weightKg - dto.competitorWeightKg) > 0.00005)
      || imported.source.config.priceContext !== dto.sourceContext.trim())) {
      throw new BadRequestException('ข้อมูลต้นทางหรือการตั้งค่าเปลี่ยน กรุณาเลือกสินค้าจากคลังใหม่');
    }
    const observation = imported?.priceIncVat != null && dto.vatIncluded && imported.currency === 'THB'
      ? { priceIncVat: imported.priceIncVat, observedAt: imported.observedAt, captureMethod: 'automatic' as const,
        capturedSourceVersion: imported.configVersion, lastError: null } : {};
    const values = {
      productId: product.product_inventory_id, ourWeightKg: dto.ourWeightKg,
      scrapingSourceId: source?.id ?? null,
      sourceUrl, competitorName: dto.competitorName.trim(), competitorSku: dto.competitorSku?.trim() ?? '',
      competitorWeightKg: dto.competitorWeightKg, sourceContext: dto.sourceContext.trim(),
      vatIncluded: dto.vatIncluded, collectionAllowed: dto.collectionAllowed, autoRefresh: dto.autoRefresh,
    };
    if (id) {
      if (dto.revision == null) throw new BadRequestException('ระบุ revision ของคู่สินค้าที่กำลังแก้ไข');
      return this.change(id, row => {
        const identityChanged = row.productId !== values.productId || row.sourceUrl !== values.sourceUrl
          || row.scrapingSourceId !== values.scrapingSourceId
          || row.competitorName !== values.competitorName || row.competitorSku !== values.competitorSku
          || Number(row.ourWeightKg) !== values.ourWeightKg || Number(row.competitorWeightKg) !== values.competitorWeightKg
          || row.sourceContext !== values.sourceContext || row.vatIncluded !== values.vatIncluded;
        Object.assign(row, values);
        if (identityChanged) {
          row.verifiedFingerprint = null; row.verifiedAt = null; row.verifiedBy = null; row.matchNote = '';
          row.priceIncVat = null; row.observedAt = null; row.captureMethod = null; row.capturedSourceVersion = null; row.lastError = null;
        }
        if (imported) {
          if (row.observedAt && imported.observedAt < row.observedAt) throw new BadRequestException('ข้อมูลจากคลังเก่ากว่าราคาที่บันทึกแล้ว กรุณาดึงใหม่');
          Object.assign(row, observation);
        }
      }, dto.revision);
    }
    const row = await this.prices.save(this.prices.create({ ...values, ...observation }));
    return this.view(await this.read(row.id));
  }

  /**
   * One click from a collected item: create the pair with the item's own name/URL/weight and the source's
   * VAT/permission settings, then record the person's confirmation. Same rules as save() + verify();
   * the note keeps what they were shown. Pack weights that can't be read from names need the full form.
   */
  async match(catalogItemId: string, sku: string, actor: string, typed?: PackSize) {
    const item = await this.scraping.item(catalogItemId);
    const size = typed ?? itemPackSize(item.name, item.weightKg);
    if (!size) throw new BadRequestException('ชื่อสินค้าคู่แข่งไม่ระบุขนาด — ใส่ขนาดแพ็กก่อน');
    const product = await this.product(sku);
    const our = ourPack(product, describeOurOffer(product).pricePerKgIncVat);
    if (size.unit !== our.unit) throw new BadRequestException(`หน่วยไม่ตรงกัน: เราขายเป็น${unitLabel[our.unit]} แต่ขนาดคู่แข่งเป็น${unitLabel[size.unit]}`);
    const competitorWeightKg = Math.round(packQuantity(size) * 10000) / 10000;
    if (competitorWeightKg <= 0) throw new BadRequestException('ขนาดแพ็กต้องมากกว่า 0');
    // Per-kg SKUs compare at the competitor's pack; others at one of our selling units.
    const perKg = ['KG', 'G', 'GM'].includes(product.selling_unit?.trim().toUpperCase() || '');
    const ourWeightKg = perKg ? competitorWeightKg : our.qty;
    const similarity = Math.round(100 * Math.max(0, ...(product.translations ?? []).map(t => nameSimilarity(item.name, t.product_name || ''))));
    const saved = await this.save({ sku: product.product_inventory_sku, ourWeightKg, sourceUrl: item.url, competitorName: item.name,
      competitorSku: item.sku, competitorWeightKg, sourceContext: item.source.config.priceContext,
      vatIncluded: item.source.config.vatIncluded, collectionAllowed: item.source.config.collectionAllowed, autoRefresh: false,
      // A typed size differs from the name on purpose, so it skips the "item unchanged" check tied to catalogItemId.
      ...(typed ? {} : { catalogItemId }) });
    let revision = saved.revision;
    if (typed || size.unit !== 'kg') {
      await this.prices.update(saved.id, { competitorUnit: size.unit,
        ...(typed ? { competitorQtyMin: size.min, competitorQtyMax: size.max, competitorPackCount: size.packCount } : {}) });
      revision = (await this.prices.findOneByOrFail({ id: saved.id })).revision; // update() bumps the version column
    }
    const note = `ยืนยันจากหน้าจับคู่: ชื่อคล้าย ${similarity}% · ของเรา ${ourWeightKg} ${unitLabel[our.unit]} / คู่แข่ง ${packSizeText(size)}${typed ? ' (ใส่ขนาดเอง)' : ''} · ราคาบนเว็บรวม VAT`;
    return this.confirm(saved.id, actor, revision, saved.ourProductVersion, note);
  }

  /**
   * The one "next step" button: same product + the web price includes VAT. In one transaction it sets
   * vatIncluded, records the person's verification, and takes the collected price (when the item is still
   * on the current reader config and not older than the stored one). Verification survives because the
   * fingerprint covers the product and reader config, not the VAT flag.
   */
  async confirm(id: string, actor: string, revision: number, ourProductVersion: string,
    note = 'ยืนยันจากหน้าเทียบราคา: สินค้าเดียวกัน และราคาบนเว็บรวม VAT') {
    const row = await this.read(id);
    const fingerprint = this.fingerprint(row);
    if (ourProductVersion !== fingerprint) throw new BadRequestException('สเปกสินค้าหรือการตั้งค่าเว็บเปลี่ยน กรุณาโหลดใหม่และตรวจคู่สินค้าอีกครั้ง');
    const item = row.scrapingSourceId ? await this.scraping.itemByUrl(row.scrapingSourceId, row.sourceUrl) : null;
    const price = item?.currency === 'THB' && item.configCurrent ? item.priceIncVat ?? singlePrice(item.fields.price) : null;
    return this.change(id, current => {
      current.vatIncluded = true;
      if (current.verifiedFingerprint !== fingerprint) {
        current.verifiedFingerprint = fingerprint; current.verifiedBy = actor; current.verifiedAt = new Date(); current.matchNote = note;
      }
      if (item && price != null && (!current.observedAt || item.observedAt >= current.observedAt)) {
        Object.assign(current, { priceIncVat: price, observedAt: item.observedAt, captureMethod: 'automatic', capturedSourceVersion: item.configVersion, lastError: null });
      }
    }, revision);
  }

  async verify(id: string, matchNote: string, actor: string, revision: number, ourProductVersion: string) {
    const row = await this.read(id);
    if (ourProductVersion !== this.fingerprint(row)) throw new BadRequestException('สเปกสินค้าหรือการตั้งค่าเว็บเปลี่ยน กรุณาโหลดใหม่และตรวจคู่สินค้าอีกครั้ง');
    if (matchNote.trim().length < 10) throw new BadRequestException('ระบุเหตุผลที่ยืนยันว่าเป็นสินค้าเทียบเคียงกัน');
    return this.change(id, current => {
      current.verifiedFingerprint = this.fingerprint(row);
      current.matchNote = matchNote.trim(); current.verifiedBy = actor; current.verifiedAt = new Date();
    }, revision);
  }

  async capture(id: string, dto: CaptureCompetitorPriceDto) {
    const observedAt = new Date(dto.observedAt);
    if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() + 300000) throw new BadRequestException('เวลาที่พบราคาต้องไม่เป็นเวลาในอนาคต');
    return this.change(id, row => {
      if (!row.vatIncluded) throw new BadRequestException('ยืนยันก่อนว่าราคานี้รวม VAT');
      if (row.observedAt && observedAt < row.observedAt) throw new BadRequestException('ใช้เวลาที่พบราคาล่าสุด ไม่น้อยกว่าข้อมูลเดิม');
      row.priceIncVat = dto.priceIncVat; row.observedAt = observedAt; row.captureMethod = 'manual'; row.capturedSourceVersion = null; row.lastError = null;
    }, dto.revision);
  }

  async refresh(id: string) {
    const row = await this.read(id);
    const state = this.view(row);
    if (!state.canRefresh) throw new BadRequestException(state.refreshReason);
    let extracted: Awaited<ReturnType<ScrapingService['readProduct']>>;
    try {
      extracted = await this.scraping.readProduct(row.scrapingSource!, row.sourceUrl);
    } catch {
      await this.change(id, current => { current.lastError = 'ดึงข้อมูลไม่สำเร็จ ตรวจลิงก์และการตั้งค่าฟิลด์ของเว็บต้นทาง'; }, row.revision);
      throw new BadRequestException('ดึงข้อมูลไม่สำเร็จ ข้อมูลเดิมยังอยู่ กรุณาลองใหม่หรือบันทึกราคาเอง');
    }
    const name = extracted.name.trim();
    const weight = extracted.weightKg;
    if (!name || name !== row.competitorName || weight == null || Math.abs(weight - Number(row.competitorWeightKg)) > 0.00005
      || extracted.url !== row.sourceUrl || (row.competitorSku && extracted.sku !== row.competitorSku)) {
      await this.change(id, current => {
        current.verifiedFingerprint = null;
        current.lastError = 'ชื่อหรือน้ำหนักจากหน้าเว็บไม่ตรงคู่ที่ยืนยัน ตรวจหน้าแหล่งที่มาและจับคู่ใหม่';
      }, row.revision);
      throw new BadRequestException('ชื่อหรือน้ำหนักไม่ตรง กรุณาตรวจคู่สินค้าใหม่ ข้อมูลราคาเดิมยังอยู่');
    }
    const price = extracted.price;
    const observedAt = extracted.observedAt;
    const available = /^(?:https?:\/\/schema.org\/)?(?:InStock|in stock|พร้อมขาย|มีสินค้า)$/i.test(extracted.fields.availability?.trim() || '');
    if (price == null || !Number.isFinite(price) || price <= 0 || price > 9999999999.99 || extracted.currency !== 'THB' || !available
      || !Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() + 300000
      || Date.now() - observedAt.getTime() > 86400000 || (row.observedAt != null && observedAt < row.observedAt)) {
      await this.change(id, current => { current.lastError = 'ราคา สกุลเงิน สถานะพร้อมขาย หรือโปรโมชันไม่ชัดเจน กรุณาบันทึกจากหน้าแหล่งที่มาเอง'; }, row.revision);
      throw new BadRequestException('ราคา THB สถานะพร้อมขาย หรือโปรโมชันไม่ชัดเจน กรุณาบันทึกราคาเอง');
    }
    return this.change(id, current => {
      current.priceIncVat = price; current.observedAt = observedAt; current.captureMethod = 'automatic';
      current.capturedSourceVersion = scrapingVersion(row.scrapingSource!.config); current.lastError = null;
    }, row.revision);
  }

  async remove(id: string) {
    const result = await this.prices.delete(id);
    if (!result.affected) throw new NotFoundException('ไม่พบคู่สินค้า');
    return { id };
  }

  /** Off until cutover (CRON_COMPETITOR_PRICES_REFRESH_ENABLED=true); josh runs its own copy until then. */
  @ScheduledCron('competitor-prices-refresh', cronConfig.competitorPricesRefresh.expression, {
    timeZone: cronConfig.competitorPricesRefresh.timeZone,
    disabled: !cronConfig.competitorPricesRefresh.enabled,
  })
  async scheduledRefresh() {
    // ponytail: in-process flag, single commerce instance. Needs a DB/Redis lock if commerce runs >1 replica.
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      // ponytail: at most 100 pages/hour; oldest first, move to jobs queue if volume exceeds this.
      const rows = await this.prices.find({ where: { autoRefresh: true, collectionAllowed: true, vatIncluded: true, verifiedFingerprint: Not(IsNull()) }, order: { updatedAt: 'ASC' }, take: 100 });
      for (const row of rows) {
        try { await this.refresh(row.id); } catch {
          // Catalog changes should not let a pending match occupy the oldest slot forever.
          try {
            await this.change(row.id, current => {
              if (!current.lastError) current.lastError = 'ตรวจคู่สินค้าและฐานราคา ก่อนดึงอัตโนมัติอีกครั้ง';
            }, row.revision);
          } catch { /* A refresh/update already advanced this revision. */ }
        }
      }
    } finally { this.refreshing = false; }
  }
}

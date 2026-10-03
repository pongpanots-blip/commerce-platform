import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { IsNull, Not, Repository } from 'typeorm';
import { cronConfig } from '../../../config/cron.config';
import { ScrapingService } from '../../platform/scraping/application/scraping.service';
import { publicUrl, scrapingVersion } from '../../platform/scraping/infrastructure/public-web.reader';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { JoshCatalogSyncService } from '../connector/josh/josh-catalog-sync.service';
import { CompetitorPrice } from './competitor-price.entity';
import { CaptureCompetitorPriceDto, SaveCompetitorPriceDto } from './competitor-price.dto';

const roundMoney = (value: number) => Math.round(value * 100) / 100;

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

/**
 * Byte-for-byte the josh formula (field order, raw string values, translation sort),
 * so matches verified in josh stay verified after the import.
 */
export function catalogFingerprint(product: JoshCatalogProduct): string {
  // Prices can change without invalidating the match; identity/pack changes require review.
  return createHash('sha256').update(JSON.stringify([
    product.sku, product.brandCode, product.brandName,
    product.countryCodeSource, product.storageTemperature, product.packagingType,
    product.packSize, product.unitsPerBox, product.weightPerUnit,
    product.sellingUnit, product.vatType,
    product.translations?.map(t => [t.language_code, t.product_name, t.product_description, t.product_detail]).sort(),
  ])).digest('hex');
}

export function catalogPricePerKg(product: JoshCatalogProduct, ourWeightKg: number): number | null {
  const price = Number(product.sellingUnitPrice);
  const unit = product.sellingUnit?.trim().toUpperCase();
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(ourWeightKg) || ourWeightKg <= 0) return null;
  if (unit === 'KG') return price;
  if (unit === 'G' || unit === 'GM') return price * 1000;
  // Confirmed weight is per selling unit, never per order unit or carton inferred from a name.
  if (unit && ['PC', 'PK', 'BX', 'CT', 'CS', 'CA', 'EA', 'BT', 'BG', 'PA', 'PT'].includes(unit)) return price / ourWeightKg;
  return null;
}

function productView(product: JoshCatalogProduct) {
  return {
    id: product.id, sku: product.sku,
    name: product.translations?.find(t => t.language_code === 'th')?.product_name
      ?? product.translations?.[0]?.product_name ?? product.sku,
    brand: product.brandName, country: product.countryCodeSource,
    storage: product.storageTemperature, packSize: product.packSize,
    sellingUnit: product.sellingUnit, sellingUnitPriceIncVat: Number(product.sellingUnitPrice),
    updatedAt: product.joshUpdatedAt, syncedAt: product.syncedAt, removed: !!product.removedAt,
  };
}

/**
 * Competitor price comparison (MER) — moved from josh. Compares against
 * commerce's copy of josh's catalog (JoshCatalogSyncService), and reads
 * competitor pages through the scraping engine in this same process.
 */
@Injectable()
export class CompetitorPricesService {
  private refreshing = false;

  constructor(
    @InjectRepository(CompetitorPrice) private readonly prices: Repository<CompetitorPrice>,
    @InjectRepository(JoshCatalogProduct) private readonly products: Repository<JoshCatalogProduct>,
    private readonly catalogSync: JoshCatalogSyncService,
    private readonly scraping: ScrapingService,
  ) {}

  private async product(sku: string) {
    const code = sku.trim();
    const copy = await this.products.findOneBy({ sku: code, removedAt: IsNull() });
    if (copy) return copy;
    // Added in josh after the last sync run: fetch just this SKU.
    let fresh: JoshCatalogProduct | null = null;
    if (this.catalogSync.configured) {
      try { fresh = await this.catalogSync.syncSku(code); } catch {
        throw new ServiceUnavailableException('ยังไม่มี SKU นี้ในสำเนาแค็ตตาล็อก และติดต่อฐานข้อมูล josh ไม่ได้ กรุณาลองใหม่ภายหลัง');
      }
    }
    if (!fresh || fresh.removedAt) throw new NotFoundException('ไม่พบ SKU นี้ในแค็ตตาล็อก Josh');
    return fresh;
  }

  async catalog(sku: string) { return productView(await this.product(sku)); }

  catalogItem(id: string) { return this.scraping.item(id); }

  private fingerprint(row: CompetitorPrice) {
    const product = catalogFingerprint(row.product);
    return row.scrapingSource ? createHash('sha256').update(product + scrapingVersion(row.scrapingSource.config)).digest('hex') : product;
  }

  private view(row: CompetitorPrice) {
    const ourRate = catalogPricePerKg(row.product, Number(row.ourWeightKg));
    const theirRate = row.priceIncVat == null ? null : Number(row.priceIncVat) / Number(row.competitorWeightKg);
    const verified = !!row.verifiedFingerprint && row.verifiedFingerprint === this.fingerprint(row);
    const reason = row.product.removedAt ? 'สินค้านี้ไม่อยู่ในแค็ตตาล็อก Josh แล้ว'
      : !verified ? 'รอตรวจและยืนยันคู่สินค้า'
      : !row.vatIncluded ? 'ยังไม่ยืนยันว่าราคาคู่แข่งรวม VAT'
      : ourRate == null ? 'ตรวจหน่วยขายและราคาของเราในแค็ตตาล็อก'
      : theirRate == null ? 'ยังไม่มีราคาคู่แข่ง'
      : row.captureMethod === 'automatic' && (!row.scrapingSource || row.capturedSourceVersion !== scrapingVersion(row.scrapingSource.config)) ? 'ตั้งค่าตัวอ่านเว็บเปลี่ยน กรุณาดึงราคาใหม่'
      : !row.observedAt || Date.now() - row.observedAt.getTime() > 86400000 ? 'ราคาเกิน 24 ชั่วโมง กรุณาอัปเดต'
      : row.lastError ? 'ดึงครั้งล่าสุดไม่สำเร็จ กรุณาตรวจแหล่งที่มา' : null;
    const refreshReason = !row.scrapingSource ? 'ตั้งค่าเว็บต้นทาง แล้วบันทึกคู่สินค้านี้อีกครั้งเพื่อเปิดตัวดึงราคา'
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
      matchNote: row.matchNote, verifiedAt: row.verifiedAt, verifiedBy: row.verifiedBy,
      vatIncluded: row.vatIncluded, collectionAllowed: row.collectionAllowed, autoRefresh: row.autoRefresh,
      canRefresh: refreshReason == null, refreshReason, observedAt: row.observedAt,
      captureMethod: row.captureMethod, lastError: row.lastError,
    };
  }

  async list() {
    const rows = await this.prices.find({ relations: ['product', 'scrapingSource'], order: { createdAt: 'DESC' } });
    return rows.map(row => this.view(row));
  }

  private async read(id: string) {
    const row = await this.prices.findOne({ where: { id }, relations: ['product', 'scrapingSource'] });
    if (!row) throw new NotFoundException('ไม่พบคู่สินค้า');
    return row;
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
      productId: product.id, ourWeightKg: dto.ourWeightKg,
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
  @Cron(cronConfig.competitorPricesRefresh.expression, {
    timeZone: cronConfig.competitorPricesRefresh.timeZone,
    disabled: !cronConfig.competitorPricesRefresh.enabled,
  })
  async scheduledRefresh() {
    // ponytail: in-process flag, single commerce instance. Needs a DB/Redis lock if commerce runs >1 replica.
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      // ponytail: at most 100 pages/run; oldest first, move to jobs queue if volume exceeds this.
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

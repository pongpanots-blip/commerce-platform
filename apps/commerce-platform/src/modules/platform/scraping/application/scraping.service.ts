import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { JSDOM } from 'jsdom';
import { ScrapedItem, ScrapingProgress, ScrapingSource } from '../domain/scraping-source.entity';
import { DiscoverScrapingDto, PreviewScrapingDto, SaveScrapingSourceDto, StartScrapingDto } from './dto/scraping.dto';
import { PublicWebReader, publicUrl, scrapingVersion, extractedWeightKg, resolveWebsite, discoveredFieldLabels } from '../infrastructure/public-web.reader';

const emptyProgress = (): ScrapingProgress => ({ pending: [], visited: [], successful: 0, failed: 0, items: 0 });

@Injectable()
export class ScrapingService {
  private ticking = false;
  constructor(
    @InjectRepository(ScrapingSource) private readonly sources: Repository<ScrapingSource>,
    @InjectRepository(ScrapedItem) private readonly items: Repository<ScrapedItem>,
    private readonly reader: PublicWebReader,
  ) {}

  private validate(dto: SaveScrapingSourceDto) {
    const origin = publicUrl(dto.origin).origin;
    if (dto.origin.replace(/\/$/, '') !== origin) throw new BadRequestException('ที่อยู่เว็บหลักใช้เฉพาะ https://ชื่อเว็บ');
    if (!dto.name.trim() || !dto.config.priceContext.trim()) throw new BadRequestException('กรอกชื่อเว็บและเงื่อนไขข้อมูล');
    if (dto.config.startUrls.some(url => publicUrl(url).origin !== origin)) throw new BadRequestException('หน้าเริ่มต้นต้องอยู่ในเว็บเดียวกัน');
    if (dto.config.pathPrefixes.some(path => !path.startsWith('/') || path.startsWith('//') || /[?#]/.test(path))) throw new BadRequestException('ขอบเขตหน้าใช้ path ที่ขึ้นต้นด้วย / เช่น /products/');
    const keys = dto.config.fields.map(f => f.key);
    if (new Set(keys).size !== keys.length || keys.some(k => ['constructor', 'prototype', '__proto__'].includes(k))) throw new BadRequestException('ชื่อฟิลด์ต้องไม่ซ้ำหรือเป็นชื่อสงวน');
    const selected = dto.config.selectedFields;
    if (selected && (new Set(selected).size !== selected.length || !selected.some(key => ['name', 'title'].includes(key))
      || selected.some(key => ['constructor', 'prototype', '__proto__'].includes(key)) || (keys.length && selected.some(key => !keys.includes(key) && key !== 'url')))) {
      throw new BadRequestException('เลือกฟิลด์ชื่อรายการ และเลือกเฉพาะฟิลด์ที่พบในการสำรวจ');
    }
    if (keys.length && !keys.some(k => k === 'name' || k === 'title')) throw new BadRequestException('เพิ่มฟิลด์ name หรือ title เพื่อระบุแต่ละรายการ');
    const document = new JSDOM('').window.document;
    try {
      for (const selector of [dto.config.itemSelector, ...dto.config.fields.map(f => f.selector)].filter(Boolean)) document.querySelector(selector);
    } catch { throw new BadRequestException('CSS selector ไม่ถูกต้อง กรุณาตรวจฟิลด์ที่ตั้งค่า'); }
    finally { document.defaultView?.close(); }
    if (dto.enabled && !dto.config.collectionAllowed) throw new BadRequestException('ยืนยันสิทธิ์ดึงข้อมูลก่อนเปิดอัตโนมัติ');
    return origin;
  }

  private view(source: ScrapingSource) {
    const { leaseUntil: _lease, progress, ...rest } = source;
    return { ...rest, configVersion: scrapingVersion(source.config), progress: {
      pages: progress.visited.length, pending: progress.pending.length, successful: progress.successful,
      failed: progress.failed, items: progress.items,
    } };
  }
  async listSources() { return (await this.sources.find({ order: { createdAt: 'DESC' } })).map(s => this.view(s)); }
  async source(id: string) {
    const source = await this.sources.findOneBy({ id });
    if (!source) throw new NotFoundException('ไม่พบเว็บที่ตั้งค่า');
    return source;
  }
  async findOrigin(url: string) { return this.sources.findOneBy({ origin: publicUrl(url).origin }); }

  async discover(dto: DiscoverScrapingDto) {
    if (!dto.collectionAllowed) throw new BadRequestException('ยืนยันสิทธิ์อ่านเว็บก่อนสำรวจ');
    const website = resolveWebsite(dto.website);
    let origin = website.url.origin;
    const base = { startUrls: [website.url.href], pathPrefixes: ['/'], mode: 'html' as const, itemSelector: '', fields: [],
      currency: 'THB', vatIncluded: false, priceContext: 'ข้อมูลสาธารณะ ไม่ใช้บัญชีสมาชิก', collectionAllowed: true,
      intervalHours: 24, maxPages: 100, delayMs: 2000 };
    const pending = [website.url.href];
    const scanned: { url: string; title: string; mode: 'html' | 'browser'; found: number; error: string | null }[] = [];
    const visited = new Set<string>();
    let best: ReturnType<PublicWebReader['inspect']> | undefined;
    let bestUrl = website.url.href;
    const warnings: string[] = [];
    // ponytail: inspect at most 6 pages and one browser fallback; broader collection starts after field selection.
    let browserUsed = false;
    for (let index = 0; pending.length && scanned.length < 6; index++) {
      const url = pending.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      let mode: 'html' | 'browser' = 'html';
      try {
        let page: { html: string; url: string };
        if (!scanned.length) {
          const response = await this.reader.fetch(url);
          const actual = publicUrl(response.url);
          if (actual.hostname.replace(/^www\./, '') !== website.url.hostname.replace(/^www\./, '')) throw new BadRequestException('เว็บเปลี่ยนโดเมน กรุณาใช้ลิงก์ปลายทางที่ต้องการเก็บ');
          if (!/html|xml/i.test(response.contentType)) throw new BadRequestException('ลิงก์นี้ไม่ใช่หน้าเว็บ HTML หรือ Sitemap');
          origin = actual.origin;
          page = { html: response.body.toString('utf8'), url: actual.href };
        } else page = await this.reader.page(url, base, origin);
        let inspection = this.reader.inspect(page.html, page.url, base);
        if (inspection.kind === 'page' && !browserUsed && !inspection.links.some(link => /\/(?:products?|p|items?|catalog|categories|category|c|shop|market)\//i.test(link)) && /<script\b/i.test(page.html)) {
          browserUsed = true;
          try {
            const rendered = await this.reader.page(page.url, { ...base, mode: 'browser' }, origin);
            const result = this.reader.inspect(rendered.html, rendered.url, { ...base, mode: 'browser' });
            if (result.items.length && (result.kind !== 'page' || !inspection.items.length)) { inspection = result; page = rendered; mode = 'browser'; }
          } catch { warnings.push('หน้าเว็บบางส่วนยังอ่านด้วยเบราว์เซอร์ไม่ได้ ให้ลองลิงก์หน้าสินค้าหรือหน้าหมวดโดยตรง'); }
        }
        scanned.push({ url: page.url, title: inspection.title, mode, found: inspection.items.length, error: null });
        const score = (result: typeof inspection) => (result.kind === 'page' ? 0 : 100) + (result.items.some(item => item.fields.price) ? 50 : 0) + Math.min(result.items.length, 10);
        if (!best || score(inspection) > score(best)) { best = inspection; bestUrl = page.url; }
        if (inspection.kind !== 'page' && inspection.items.length) break;
        const links = inspection.links.map(link => {
          try { return publicUrl(new URL(link, page.url).href); } catch { return null; }
        }).filter((link): link is URL => !!link && link.origin === origin && !visited.has(link.href)
          && !/\/(?:login|signin|account|admin|cart|checkout|privacy|terms|contact|payment)(?:\/|$)/i.test(link.pathname));
        links.sort((a, b) => Number(/\/(?:products?|p|items?)\//i.test(b.pathname)) - Number(/\/(?:products?|p|items?)\//i.test(a.pathname)));
        for (const link of links.slice(0, 20)) if (!pending.includes(link.href)) pending.push(link.href);
      } catch (error) {
        scanned.push({ url, title: '', mode, found: 0, error: error instanceof BadRequestException ? error.message : 'เปิดหน้านี้ไม่สำเร็จ' });
      }
    }
    if (!best?.items.length) return { ready: false, proposal: null, fields: [], preview: null, scannedPages: scanned,
      warnings: [...warnings, 'ยังไม่พบข้อมูลที่อ่านได้ ลองใส่ลิงก์หน้าสินค้า หน้ารายการ หรือหน้าบทความโดยตรง'] };
    if (best.kind === 'page') warnings.push('พบข้อมูลระดับหน้าเว็บ ยังไม่พบรายการสินค้า เลือกเก็บเป็นข้อมูลทั่วไปหรือลองลิงก์หมวดสินค้า');
    const fieldKeys = [...new Set(best.items.flatMap(item => Object.keys(item.fields).filter(key => item.fields[key])))];
    if (!fieldKeys.includes('price')) warnings.push('ยังไม่พบฟิลด์ราคาในหน้าที่อ่านได้ หากต้องการเทียบสินค้า ลองลิงก์หน้าสินค้าหรือหมวดโดยตรง');
    else if (best.items.every(item => item.price == null)) warnings.push('พบข้อความราคา แต่ตัวเลขหรือเงื่อนไขยังไม่ชัดเจน กรุณาตรวจตัวอย่างก่อนนำไปเทียบ');
    if (!fieldKeys.includes('url')) fieldKeys.push('url');
    const required = ['name', 'title', 'url'];
    const recommended = [...required, 'price', 'sku', 'weight', 'currency', 'availability', 'brand'];
    fieldKeys.sort((a, b) => (recommended.includes(a) ? recommended.indexOf(a) : 100) - (recommended.includes(b) ? recommended.indexOf(b) : 100));
    const fields = fieldKeys.slice(0, 20).map(key => ({ key, label: best!.config.fields.find(field => field.key === key)?.label || discoveredFieldLabels[key] || key,
      required: required.includes(key), recommended: recommended.includes(key),
      examples: [...new Set(best!.items.map(item => (key === 'url' ? item.url : item.fields[key]) || '').filter(Boolean))].slice(0, 3),
    }));
    const proposal = { name: website.name, origin, enabled: false, config: { ...best.config, startUrls: [bestUrl],
      selectedFields: fields.filter(field => field.recommended || field.required).map(field => field.key) } };
    return { ready: true, proposal, fields, preview: { url: bestUrl, observedAt: new Date(), items: best.items.slice(0, 10),
      found: best.items.length, links: best.links.length, sitemap: best.sitemap, message: '' }, scannedPages: scanned, warnings };
  }

  async save(dto: SaveScrapingSourceDto, id?: string) {
    const origin = this.validate(dto);
    if (!id) return this.view(await this.sources.save(this.sources.create({ name: dto.name.trim(), origin, config: dto.config, enabled: dto.enabled, progress: emptyProgress() })));
    return this.sources.manager.transaction(async manager => {
      const repository = manager.getRepository(ScrapingSource);
      const current = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) throw new NotFoundException('ไม่พบเว็บที่ตั้งค่า');
      if (dto.revision !== current.revision) throw new BadRequestException('ตั้งค่าเว็บเปลี่ยนแล้ว กรุณาโหลดใหม่');
      if (current.origin !== origin) throw new BadRequestException('เปลี่ยนชื่อโดเมนให้เพิ่มเป็นเว็บใหม่ เพื่อรักษาแหล่งที่มาข้อมูลเดิม');
      if (JSON.stringify([current.config.startUrls, current.config.pathPrefixes]) !== JSON.stringify([dto.config.startUrls, dto.config.pathPrefixes])) current.progress = emptyProgress();
      Object.assign(current, { name: dto.name.trim(), config: dto.config, enabled: dto.enabled, revision: current.revision + 1,
        status: dto.enabled ? 'idle' : 'paused', leaseUntil: null, lastError: null });
      return this.view(await repository.save(current));
    });
  }

  async preview(dto: PreviewScrapingDto) {
    const origin = this.validate(dto);
    if (!dto.config.collectionAllowed) throw new BadRequestException('ยืนยันสิทธิ์ดึงข้อมูลก่อนทดลองอ่านเว็บ');
    if (publicUrl(dto.sampleUrl).origin !== origin) throw new BadRequestException('หน้าทดลองต้องอยู่ในเว็บเดียวกัน');
    const page = await this.reader.page(dto.sampleUrl, dto.config, origin);
    const result = this.reader.extract(page.html, page.url, dto.config);
    return { url: page.url, observedAt: new Date(), items: result.items.slice(0, 10), found: result.items.length,
      links: result.links.length, sitemap: result.sitemap,
      message: !result.items.length && !result.sitemap ? 'ยังไม่พบรายการ ตรวจ selector หรือใช้โหมดเบราว์เซอร์สำหรับเว็บที่โหลดด้วย JavaScript' : '' };
  }

  async start(id: string, dto: StartScrapingDto) {
    return this.sources.manager.transaction(async manager => {
      const repository = manager.getRepository(ScrapingSource);
      const source = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!source) throw new NotFoundException('ไม่พบเว็บที่ตั้งค่า');
      if (source.revision !== dto.revision) throw new BadRequestException('ตั้งค่าเว็บเปลี่ยนแล้ว กรุณาโหลดใหม่');
      if (!source.config.collectionAllowed) throw new BadRequestException('ยืนยันสิทธิ์ดึงข้อมูลก่อนเริ่มเก็บ');
      if (source.status === 'running') throw new BadRequestException('เว็บนี้กำลังเก็บข้อมูลอยู่');
      if (dto.restart || !source.progress.pending.length) {
        source.progress = { ...emptyProgress(), pending: [...new Set(source.config.startUrls.map(u => publicUrl(u).href))] };
      } else if (source.progress.visited.length >= source.config.maxPages) {
        throw new BadRequestException('ถึงเพดานจำนวนหน้า เพิ่มเพดานในการตั้งค่าหรือเริ่มรอบใหม่');
      }
      source.status = 'running'; source.leaseUntil = null; source.lastError = null; source.revision += 1; source.lastRunAt = new Date();
      return this.view(await repository.save(source));
    });
  }
  async stop(id: string, revision: number) {
    const result = await this.sources.update({ id, revision }, { status: 'paused', enabled: false, leaseUntil: null, revision: revision + 1 });
    if (!result.affected) throw new BadRequestException('ตั้งค่าเว็บเปลี่ยนแล้ว กรุณาโหลดใหม่');
    return this.view(await this.source(id));
  }

  async listItems(sourceId: string | undefined, search: string, page: number) {
    const query = this.items.createQueryBuilder('item').leftJoinAndSelect('item.source', 'source');
    if (sourceId) query.andWhere('item.sourceId = :sourceId', { sourceId });
    if (search.trim()) query.andWhere('(item.name ILIKE :search OR item.sku ILIKE :search)', { search: `%${search.trim().slice(0, 200)}%` });
    const [rows, total] = await query.orderBy('item.observedAt', 'DESC').addOrderBy('item.id', 'ASC').skip((page - 1) * 30).take(30).getManyAndCount();
    return { items: rows.map(row => this.itemView(row)), total, page, pageSize: 30 };
  }
  private itemView(row: ScrapedItem) {
    return { ...row, source: this.view(row.source), priceIncVat: row.priceIncVat == null ? null : Number(row.priceIncVat),
      weightKg: row.weightKg == null ? null : Number(row.weightKg), configCurrent: row.configVersion === scrapingVersion(row.source.config) };
  }
  async item(id: string) {
    const row = await this.items.findOne({ where: { id }, relations: ['source'] });
    if (!row) throw new NotFoundException('ไม่พบรายการที่เก็บ');
    return this.itemView(row);
  }
  async readProduct(source: ScrapingSource, url: string) {
    if (!source.config.collectionAllowed) throw new BadRequestException('เว็บนี้ยังไม่ยืนยันสิทธิ์ดึงข้อมูล');
    const existing = await this.items.findOneBy({ sourceId: source.id, url });
    const page = await this.reader.page(existing?.pageUrl || url, source.config, source.origin);
    const item = this.reader.extract(page.html, page.url, source.config).items.find(item => item.url === url);
    if (!item) throw new BadRequestException('ไม่พบรายการตรงลิงก์ที่ยืนยัน ตรวจการตั้งค่าฟิลด์');
    return { ...item, weightKg: extractedWeightKg(item.fields.weight || item.name), observedAt: new Date() };
  }

  @Cron('*/15 * * * * *', { disabled: process.env.SCRAPING_CRON_DISABLED === 'true' })
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.sources.find({ where: { enabled: true } });
      for (const source of due) {
        if (['idle', 'completed'].includes(source.status) && (!source.lastRunAt || Date.now() - source.lastRunAt.getTime() >= source.config.intervalHours * 3600000)) {
          try { await this.start(source.id, { revision: source.revision, restart: true }); } catch { /* Another replica started it. */ }
        }
      }
      const running = await this.sources.find({ where: { status: 'running' }, order: { updatedAt: 'ASC' }, take: 5 });
      // ponytail: persisted frontier, 2 pages/source/tick, max 5000 pages/run. Single instance; needs distributed lock if it scales.
      for (const source of running) await this.batch(source.id);
    } finally { this.ticking = false; }
  }

  async batch(id: string) {
    const leaseUntil = new Date(Date.now() + 180000);
    const claim = await this.sources.createQueryBuilder().update().set({ leaseUntil }).where('id = :id AND status = :status AND (lease_until IS NULL OR lease_until < now())', { id, status: 'running' }).execute();
    if (!claim.affected) return;
    const source = await this.source(id);
    try {
      for (let pageNumber = 0; pageNumber < 2; pageNumber++) {
        const state = await this.source(id);
        if (state.status !== 'running' || state.revision !== source.revision || state.leaseUntil?.getTime() !== leaseUntil.getTime()) break;
        const requested = source.progress.pending[0];
        if (!requested || source.progress.visited.length >= source.config.maxPages) break;
        let result: ReturnType<PublicWebReader['extract']> | undefined;
        let error: string | null = null;
        try {
          const page = await this.reader.page(requested, source.config, source.origin);
          result = this.reader.extract(page.html, page.url, source.config);
        } catch (err) { error = err instanceof BadRequestException ? err.message : 'อ่านหน้านี้ไม่สำเร็จ ตรวจลิงก์และ selector หรือลองโหมดเบราว์เซอร์'; }
        const keepRunning = await this.sources.manager.transaction(async manager => {
          const repository = manager.getRepository(ScrapingSource);
          const current = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
          if (!current || current.status !== 'running' || current.revision !== source.revision || current.leaseUntil?.getTime() !== leaseUntil.getTime()) return false;
          const progress = current.progress;
          progress.pending.shift(); progress.visited.push(requested);
          if (result) {
            progress.successful += 1;
            const uniqueItems = [...new Map(result.items.map(item => [item.url, item])).values()];
            if (uniqueItems.length) await manager.getRepository(ScrapedItem).upsert(uniqueItems.map(item => ({
              sourceId: id, url: item.url, pageUrl: item.pageUrl, name: item.name, sku: item.sku, fields: item.fields,
              priceIncVat: source.config.vatIncluded && item.currency === 'THB' ? item.price : null,
              weightKg: extractedWeightKg(item.fields.weight || item.name), currency: item.currency,
              configVersion: scrapingVersion(source.config), observedAt: new Date(),
            })), ['sourceId', 'url']);
            progress.items += uniqueItems.length;
            const known = new Set([...progress.visited, ...progress.pending]);
            for (const link of result.links) {
              let url: URL;
              try { url = publicUrl(new URL(link, requested).href); } catch { continue; }
              if (url.origin !== source.origin || known.has(url.href)) continue;
              if (!result.sitemap && !source.config.pathPrefixes.some(prefix => url.pathname.startsWith(prefix))) continue;
              // Sitemaps may link to another sitemap outside catalog paths; product paths remain scoped.
              if (result.sitemap && !/\.xml$/i.test(url.pathname) && !source.config.pathPrefixes.some(prefix => url.pathname.startsWith(prefix))) continue;
              if (known.size >= 5000) { error = 'พบลิงก์ถึงเพดาน 5,000 หน้า กรุณาแยกขอบเขตการเก็บ'; break; }
              progress.pending.push(url.href); known.add(url.href);
            }
          } else progress.failed += 1;
          current.lastError = error || current.lastError;
          current.status = !progress.pending.length ? (progress.failed || current.lastError ? 'limited' : 'completed') : progress.visited.length >= source.config.maxPages ? 'limited' : 'running';
          await repository.save(current);
          source.progress = current.progress;
          return current.status === 'running';
        });
        if (!keepRunning) break;
        await new Promise(resolve => setTimeout(resolve, source.config.delayMs));
      }
    } finally {
      await this.sources.createQueryBuilder().update().set({ leaseUntil: null }).where('id = :id AND revision = :revision AND lease_until = :leaseUntil', { id, revision: source.revision, leaseUntil }).execute();
    }
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { JSDOM } from 'jsdom';
import { ScrapedItem, ScrapingProgress, ScrapingSource } from '../domain/scraping-source.entity';
import { Setting } from '../../../core/settings/infrastructure/setting.entity';
import { DiscoverScrapingDto, PreviewScrapingDto, SaveScrapingSourceDto, SaveSiteLoginDto, StartScrapingDto } from './dto/scraping.dto';
import { decryptCredential, encryptCredential } from '../infrastructure/credential-cipher';
import { PublicWebReader, publicUrl, scrapingVersion, extractedWeightKg, resolveWebsite, discoveredFieldLabels, ExtractedWebItem, SiteLogin } from '../infrastructure/public-web.reader';
import { ScheduledCron } from '../../../../shared-kernel/infrastructure/scheduled-task';

const emptyProgress = (): ScrapingProgress => ({ pending: [], visited: [], successful: 0, failed: 0, items: 0 });
const envInt = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};
/** Same env names and defaults as josh's appConfig.scraping. */
export const scrapingSettings = () => ({
  /** Competitor-site browser sessions allowed at once (each is a Chromium on this server). */
  maxBrowserSessions: envInt('SCRAPING_MAX_BROWSER_SESSIONS', 2, 1, 10),
  /** Night window (Bangkok hour, start inclusive) for sources marked night-only. */
  nightStartHour: envInt('SCRAPING_NIGHT_START_HOUR', 0, 0, 23),
  /** Night window end (Bangkok hour, exclusive); a run still going then pauses until next night. */
  nightEndHour: envInt('SCRAPING_NIGHT_END_HOUR', 6, 1, 24),
});
/** Bangkok hour inside the night window (SCRAPING_NIGHT_*, default 00:00–06:00). */
export function inNightWindow(now = new Date(), window = scrapingSettings()) {
  const hour = (now.getUTCHours() + 7) % 24;
  return window.nightStartHour <= window.nightEndHour
    ? hour >= window.nightStartHour && hour < window.nightEndHour
    : hour >= window.nightStartHour || hour < window.nightEndHour;
}
const pagedLeaseMs = 600000;
/** Pages read right away when a person switches a site to "เก็บทุกหน้า"; the rest waits for the night window. */
const FIRST_LOOK_PAGES = 20;
const PAGED_DELAY_MS = 1000;
/** A dropped paged run retries itself this many times in a row (30 s, 60 s, 90 s apart) before it waits for a person. */
const MAX_RETRIES = 3;
type PagedRunOptions = { firstLookPages?: number; ignoreNight?: boolean };
/**
 * The listing a stopped paged source can continue from page it reached: still pending (gave up after retries), or
 * already dropped by a run before retries existed while well short of the site's page count. Visited = `<listing>#page=N`.
 */
const unfinishedListing = (source: ScrapingSource) => {
  if (source.config.pagination !== 'browser' || source.status !== 'limited') return null;
  if (source.progress.pending.length) return source.progress.pending[0];
  const expected = source.config.expectedPages;
  const last = source.progress.visited.at(-1);
  return expected && last?.includes('#page=') && source.progress.visited.length < expected * 0.95 ? last.slice(0, last.lastIndexOf('#page=')) : null;
};

@Injectable()
export class ScrapingService {
  private ticking = false;
  /** Paged browser sessions running in this process (each holds a renewed lease in the DB too). */
  private readonly sessions = new Set<string>();
  constructor(
    @InjectRepository(ScrapingSource) private readonly sources: Repository<ScrapingSource>,
    @InjectRepository(ScrapedItem) private readonly items: Repository<ScrapedItem>,
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
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
    const { leaseUntil: _lease, progress, loginPasswordEnc, loginUrl, loginUsername, ...rest } = source;
    // What a running source is doing right now, so "กำลังเก็บ" never shows while it is only waiting for the night.
    // 'retrying': dropped mid-listing, retrying on its own; 'gave_up': dropped MAX_RETRIES times, waiting for "เก็บต่อเลยตอนนี้".
    const activity = unfinishedListing(source) ? 'gave_up' as const
      : source.status !== 'running' ? null
      : source.progress.retries ? 'retrying' as const
      : source.leaseUntil && source.leaseUntil.getTime() > Date.now() ? (source.progress.catchUp ? 'catching_up' as const : 'reading' as const)
      : source.config.nightOnly && !inNightWindow() && !source.progress.now ? 'waiting_for_night' as const : 'queued' as const;
    return { ...rest, configVersion: scrapingVersion(source.config), activity,
      // Prices read while logged in are member prices; the password itself never leaves the server.
      login: loginUsername && loginUrl ? { url: loginUrl, username: loginUsername, hasPassword: !!loginPasswordEnc } : null,
      progress: {
      pages: progress.visited.length, pending: progress.pending.length, successful: progress.successful,
      failed: progress.failed, items: progress.items, catchUp: progress.catchUp ?? null,
    } };
  }
  /**
   * Master switch for all background collection (trial period). Global row (scope 'marketing', key
   * 'competitor_scraping') in commerce's generic settings table — josh keeps it in marketing_settings. Default on.
   */
  private automationRow() { return this.settings.findOneBy({ scope: 'marketing', key: 'competitor_scraping', organizationId: IsNull() }); }
  async automation() {
    const row = await this.automationRow();
    const value = (row?.value ?? {}) as { enabled?: boolean; updatedBy?: string };
    return { enabled: value.enabled !== false, updatedAt: row?.updatedAt ?? null, updatedBy: value.updatedBy ?? null };
  }
  async setAutomation(enabled: boolean, actor: string) {
    const row = await this.automationRow();
    await this.settings.save({ ...(row ?? { scope: 'marketing', key: 'competitor_scraping', organizationId: null }), value: { enabled, updatedBy: actor } });
    return this.automation();
  }

  async listSources() { return (await this.sources.find({ order: { createdAt: 'DESC' } })).map(s => this.view(s)); }
  async source(id: string) {
    const source = await this.sources.findOneBy({ id });
    if (!source) throw new NotFoundException('ไม่พบเว็บที่ตั้งค่า');
    return source;
  }
  sourcesByIds(ids: string[]) { return ids.length ? this.sources.findBy({ id: In([...new Set(ids)]) }) : Promise.resolve([]); }
  /** Decrypted only for the length of one browser session. */
  private siteLogin(source: ScrapingSource): SiteLogin | undefined {
    return source.loginUrl && source.loginUsername && source.loginPasswordEnc
      ? { url: source.loginUrl, username: source.loginUsername, password: decryptCredential(source.loginPasswordEnc) } : undefined;
  }

  async saveLogin(id: string, dto: SaveSiteLoginDto) {
    const source = await this.source(id);
    publicUrl(dto.url);
    if (!dto.password && !source.loginPasswordEnc) throw new BadRequestException('กรอกรหัสผ่านของบัญชีเว็บนี้');
    // A new login changes which prices are read (member vs public): restart from a clean run.
    await this.sources.update({ id }, { loginUrl: publicUrl(dto.url).href, loginUsername: dto.username.trim(),
      ...(dto.password ? { loginPasswordEnc: encryptCredential(dto.password) } : {}), revision: source.revision + 1, status: 'idle', progress: emptyProgress(), leaseUntil: null });
    return this.view(await this.source(id));
  }

  async clearLogin(id: string) {
    const source = await this.source(id);
    await this.sources.update({ id }, { loginUrl: null, loginUsername: null, loginPasswordEnc: null, revision: source.revision + 1, status: 'idle', progress: emptyProgress(), leaseUntil: null });
    return this.view(await this.source(id));
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
        if (!scanned.length && dto.login) {
          mode = 'browser';
          page = await this.reader.page(url, { ...base, mode: 'browser' }, origin, dto.login);
          origin = publicUrl(page.url).origin;
        } else if (!scanned.length) {
          const response = await this.reader.fetch(url);
          const actual = publicUrl(response.url);
          if (actual.hostname.replace(/^www\./, '') !== website.url.hostname.replace(/^www\./, '')) throw new BadRequestException('เว็บเปลี่ยนโดเมน กรุณาใช้ลิงก์ปลายทางที่ต้องการเก็บ');
          if (!/html|xml/i.test(response.contentType)) throw new BadRequestException('ลิงก์นี้ไม่ใช่หน้าเว็บ HTML หรือ Sitemap');
          origin = actual.origin;
          page = { html: response.body.toString('utf8'), url: actual.href };
        } else page = await this.reader.page(url, base, origin, dto.login);
        let inspection = this.reader.inspect(page.html, page.url, base);
        if (inspection.kind === 'page' && !browserUsed && !inspection.links.some(link => /\/(?:products?|p|items?|catalog|categories|category|c|shop|market)\//i.test(link)) && /<script\b/i.test(page.html)) {
          browserUsed = true;
          try {
            const rendered = await this.reader.page(page.url, { ...base, mode: 'browser' }, origin, dto.login);
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
    const recommended = [...required, 'price', 'unitPrice', 'image', 'sku', 'weight', 'currency', 'availability', 'brand'];
    fieldKeys.sort((a, b) => (recommended.includes(a) ? recommended.indexOf(a) : 100) - (recommended.includes(b) ? recommended.indexOf(b) : 100));
    const fields = fieldKeys.slice(0, 20).map(key => ({ key, label: best!.config.fields.find(field => field.key === key)?.label || discoveredFieldLabels[key] || key,
      required: required.includes(key), recommended: recommended.includes(key),
      examples: [...new Set(best!.items.map(item => (key === 'url' ? item.url : item.fields[key]) || '').filter(Boolean))].slice(0, 3),
    }));
    // Try two pages in a real browser so the user sees paging works before starting a background run.
    let paging: { pages: { page: number; found: number; fresh: number }[]; totalPages: number | null; works: boolean } | null = null;
    if (best.kind === 'list') {
      const seen = new Set<string>();
      const pages: { page: number; found: number; fresh: number }[] = [];
      try {
        const result = await this.reader.paginate(bestUrl, best.config, origin, { skip: 0, maxPages: 2, delayMs: 1000, login: dto.login, onPage: async (html, url) => {
          const items = this.reader.extract(html, url, best!.config).items;
          const fresh = items.filter(item => !seen.has(item.url));
          fresh.forEach(item => seen.add(item.url));
          pages.push({ page: pages.length + 1, found: items.length, fresh: fresh.length });
          return true;
        } });
        paging = { pages, totalPages: result.totalPages, works: (pages[1]?.fresh || 0) > 0 };
        if (!paging.works) warnings.push('ไม่พบหน้าถัดไป ระบบจะเก็บเฉพาะหน้านี้และลิงก์ที่พบ');
      } catch { warnings.push('ลองเปิดหน้าถัดไปไม่สำเร็จ ระบบจะเก็บเฉพาะหน้าที่อ่านได้'); }
    }
    const proposal = { name: website.name, origin, enabled: false, config: { ...best.config, startUrls: [bestUrl],
      pagination: paging?.works ? 'browser' as const : 'none' as const,
      // Big paged sites run as one long session at night; the page cap starts at what the site reports.
      ...(paging?.works ? { nightOnly: true, intervalHours: 24, ...(paging.totalPages ? { expectedPages: paging.totalPages, maxPages: Math.min(5000, paging.totalPages) } : {}) } : {}),
      selectedFields: fields.filter(field => field.recommended || field.required).map(field => field.key) } };
    return { ready: true, proposal, fields, paging, preview: { url: bestUrl, observedAt: new Date(), items: best.items.slice(0, 10),
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

  /**
   * One click for sources made before paging existed ("link crawl" stops after the links it saw — Makro 40 items):
   * switch to the nightly whole-listing run and answer at once. A first look of FIRST_LOOK_PAGES pages runs now in
   * the background so the person sees the item count grow; the rest continues in the night window.
   */
  async enablePaging(id: string, revision: number) {
    const source = await this.source(id);
    if (source.revision !== revision) throw new BadRequestException('ตั้งค่าเว็บเปลี่ยนแล้ว กรุณาโหลดใหม่');
    if (source.config.pagination === 'browser') throw new BadRequestException('เว็บนี้เก็บทุกหน้าอยู่แล้ว');
    if (!source.config.collectionAllowed) throw new BadRequestException('ยืนยันสิทธิ์ดึงข้อมูลก่อนเริ่มเก็บ');
    const config = { ...source.config, pagination: 'browser' as const, nightOnly: true, intervalHours: 24, maxPages: 5000 };
    const saved = await this.save({ name: source.name, origin: source.origin, enabled: true, config, revision }, id);
    return this.start(id, { revision: saved.revision, restart: true, firstLook: true });
  }

  /**
   * "เก็บต่อเลยตอนนี้": a paged site that is waiting for the night, or that gave up after MAX_RETRIES drops,
   * continues now from the page it reached, in the background, until done or stopped.
   */
  async runNow(id: string, revision: number) {
    const source = await this.source(id);
    if (source.revision !== revision) throw new BadRequestException('ตั้งค่าเว็บเปลี่ยนแล้ว กรุณาโหลดใหม่');
    const listing = unfinishedListing(source);
    if ((source.status !== 'running' && !listing) || source.config.pagination !== 'browser') throw new BadRequestException('เว็บนี้ไม่ได้รอเก็บอยู่ — กด “เริ่มเก็บ” แทน');
    const patch = { now: 'all' as const, retries: 0, failed: 0, ...(listing && !source.progress.pending.length ? { pending: [listing] } : {}) };
    // Saved, so the run survives a deploy/restart: the tick picks it up again (see tick).
    await this.sources.createQueryBuilder().update()
      .set({ status: 'running', lastError: null, progress: () => 'progress || CAST(:patch AS jsonb)' })
      .where('id = :id AND revision = :revision', { id, revision }).setParameter('patch', JSON.stringify(patch)).execute();
    this.launch(id, { ignoreNight: true }); // already reading → no-op
    return this.view({ ...source, status: 'running', lastError: null, progress: { ...source.progress, ...patch }, leaseUntil: new Date(Date.now() + 5000) }); // shows as reading at once
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

  /** `firstLook`: for a paged source, read FIRST_LOOK_PAGES pages now in the background so a person sees items at once. */
  async start(id: string, dto: StartScrapingDto & { firstLook?: boolean }) {
    const started = await this.sources.manager.transaction(async manager => {
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
      source.progress.retries = 0;
      if (dto.firstLook && source.config.pagination === 'browser') source.progress.now = 'first_look'; else delete source.progress.now;
      return this.view(await repository.save(source));
    });
    if (dto.firstLook && started.config.pagination === 'browser') this.launch(id, { firstLookPages: FIRST_LOOK_PAGES, ignoreNight: true });
    return started;
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
  /** Changes whenever collected items are added, updated or removed. */
  async itemsStamp() {
    const [row] = await this.items.query('SELECT count(*)::text AS n, coalesce(max(updated_at), now())::text AS at FROM scraped_items');
    return `${row.n}:${row.at}`;
  }
  /** Slim rows of every collected item, for matching one of our SKUs against all sites. */
  async matchableItems() {
    const rows = await this.items.createQueryBuilder('item').innerJoin('item.source', 'source')
      .select(['item.id AS id', 'item.name AS name', 'item.url AS url', 'item.weight_kg AS "weightKg"', 'item.price_inc_vat AS "priceIncVat"',
        "item.fields->>'image' AS image", `item.fields->>'price' AS "rawPrice"`, 'source.id AS "sourceId"', 'source.name AS "sourceName"'])
      .getRawMany<{ id: string; name: string; url: string; weightKg: string | null; priceIncVat: string | null; image: string | null; rawPrice: string | null; sourceId: string; sourceName: string }>();
    return rows.map(row => ({ ...row, weightKg: row.weightKg == null ? null : Number(row.weightKg), priceIncVat: row.priceIncVat == null ? null : Number(row.priceIncVat) }));
  }
  async itemByUrl(sourceId: string, url: string) {
    const row = await this.items.findOne({ where: { sourceId, url }, relations: ['source'] });
    return row ? this.itemView(row) : null;
  }
  async item(id: string) {
    const row = await this.items.findOne({ where: { id }, relations: ['source'] });
    if (!row) throw new NotFoundException('ไม่พบรายการที่เก็บ');
    return this.itemView(row);
  }
  async readProduct(source: ScrapingSource, url: string) {
    if (!source.config.collectionAllowed) throw new BadRequestException('เว็บนี้ยังไม่ยืนยันสิทธิ์ดึงข้อมูล');
    const existing = await this.items.findOneBy({ sourceId: source.id, url });
    const page = await this.reader.page(existing?.pageUrl || url, source.config, source.origin, this.siteLogin(source));
    const item = this.reader.extract(page.html, page.url, source.config).items.find(item => item.url === url);
    if (!item) throw new BadRequestException('ไม่พบรายการตรงลิงก์ที่ยืนยัน ตรวจการตั้งค่าฟิลด์');
    return { ...item, weightKg: extractedWeightKg(item.fields.weight || item.name), observedAt: new Date() };
  }

  @ScheduledCron('scraping-tick', '*/15 * * * * *', { disabled: process.env.SCRAPING_CRON_DISABLED === 'true' })
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!(await this.automation()).enabled) return; // master switch off: no scheduled starts, no background reads
      const due = await this.sources.find({ where: { enabled: true } });
      for (const source of due) {
        if (source.config.nightOnly && !inNightWindow()) continue;
        if (['idle', 'completed', 'limited'].includes(source.status) && (!source.lastRunAt || Date.now() - source.lastRunAt.getTime() >= source.config.intervalHours * 3600000)) {
          try { await this.start(source.id, { revision: source.revision, restart: true }); } catch { /* Another replica started it. */ }
        }
      }
      const running = await this.sources.find({ where: { status: 'running' }, order: { updatedAt: 'ASC' }, take: 20 });
      for (const source of running) {
        if (source.config.pagination !== 'browser') { await this.batch(source.id); continue; } // link crawl: 2 pages per tick
        // Paged listings run as one long session outside this tick, at most maxBrowserSessions at once.
        // ponytail: in-process session cap + DB lease; move scraping to its own worker container if the API box feels it.
        const now = source.progress.now;
        if ((source.config.nightOnly && !inNightWindow() && !now) || this.sessions.has(source.id) || this.sessions.size >= scrapingSettings().maxBrowserSessions) continue;
        this.launch(source.id, now ? { ignoreNight: true, firstLookPages: now === 'first_look' ? FIRST_LOOK_PAGES : undefined } : {});
      }
    } finally { this.ticking = false; }
  }

  /** One paged browser session per source in this process, whoever starts it (tick, run-now, first look). */
  private launch(id: string, options: PagedRunOptions) {
    if (this.sessions.has(id)) return;
    this.sessions.add(id);
    void this.batch(id, options).catch(() => undefined).finally(() => this.sessions.delete(id));
  }

  async batch(id: string, options: PagedRunOptions = {}) {
    const paged = (await this.sources.findOneBy({ id }))?.config.pagination === 'browser';
    // Paged runs hold one long session and renew this lease on every page (pagedBatch).
    const leaseUntil = new Date(Date.now() + (paged ? pagedLeaseMs : 180000));
    const lease = { until: leaseUntil };
    const claim = await this.sources.createQueryBuilder().update().set({ leaseUntil }).where('id = :id AND status = :status AND (lease_until IS NULL OR lease_until < now())', { id, status: 'running' }).execute();
    if (!claim.affected) return;
    const source = await this.source(id);
    try {
      if (paged) return await this.pagedBatch(id, source, lease, options);
      for (let pageNumber = 0; pageNumber < 2; pageNumber++) {
        const state = await this.source(id);
        if (state.status !== 'running' || state.revision !== source.revision || state.leaseUntil?.getTime() !== leaseUntil.getTime()) break;
        const requested = source.progress.pending[0];
        if (!requested || source.progress.visited.length >= source.config.maxPages) break;
        let result: ReturnType<PublicWebReader['extract']> | undefined;
        let error: string | null = null;
        try {
          const page = await this.reader.page(requested, source.config, source.origin, this.siteLogin(source));
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
            progress.items += await this.saveItems(manager, source, result.items);
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
      await this.sources.createQueryBuilder().update().set({ leaseUntil: null }).where('id = :id AND revision = :revision AND lease_until = :leaseUntil', { id, revision: source.revision, leaseUntil: lease.until }).execute();
    }
  }

  private async saveItems(manager: EntityManager, source: ScrapingSource, items: ExtractedWebItem[]) {
    const uniqueItems = [...new Map(items.map(item => [item.url, item])).values()];
    if (uniqueItems.length) await manager.getRepository(ScrapedItem).upsert(uniqueItems.map(item => ({
      sourceId: source.id, url: item.url, pageUrl: item.pageUrl, name: item.name, sku: item.sku, fields: item.fields,
      priceIncVat: source.config.vatIncluded && item.currency === 'THB' ? item.price : null,
      weightKg: extractedWeightKg(item.fields.weight || item.name), currency: item.currency,
      configVersion: scrapingVersion(source.config), observedAt: new Date(),
    })), ['sourceId', 'url']);
    await this.refreshPairs(manager, source, uniqueItems);
    return uniqueItems.length;
  }

  /**
   * Matched pairs on these URLs take the run's price, so a nightly run keeps comparisons fresh without a
   * per-pair fetch. Only VAT-confirmed pairs, single clear THB prices, never an older observation; a changed
   * name or pack weight flags the pair for a person instead of silently pricing a different product.
   */
  private async refreshPairs(manager: EntityManager, source: ScrapingSource, items: ExtractedWebItem[]) {
    const rows = items.filter(item => item.currency === 'THB')
      .map(item => ({ url: item.url, name: item.name, price: item.price, weight: extractedWeightKg(item.fields.weight || item.name) }));
    if (!rows.length) return;
    const values = `FROM jsonb_to_recordset($2::jsonb) AS v(url text, name text, price numeric, weight numeric)
      WHERE cp.scraping_source_id = $1 AND cp.source_url = v.url`;
    // ponytail: commerce's competitor_prices has no competitor_qty_min / competitor_unit yet (josh does): weight is always re-checked.
    const same = `cp.competitor_name = v.name AND (v.weight IS NULL OR abs(cp.competitor_weight_kg - v.weight) <= 0.00005)`;
    await manager.query(`UPDATE competitor_prices cp SET price_inc_vat = v.price, observed_at = now(), capture_method = 'automatic',
      captured_source_version = $3, last_error = NULL, revision = cp.revision + 1, updated_at = now()
      ${values} AND cp.vat_included AND v.price IS NOT NULL AND ${same} AND (cp.observed_at IS NULL OR cp.observed_at <= now())`,
      [source.id, JSON.stringify(rows), scrapingVersion(source.config)]);
    await manager.query(`UPDATE competitor_prices cp SET last_error = 'สินค้าต้นทางเปลี่ยนชื่อหรือน้ำหนัก กรุณาตรวจคู่สินค้าใหม่', revision = cp.revision + 1, updated_at = now()
      ${values} AND NOT (${same}) AND cp.last_error IS DISTINCT FROM 'สินค้าต้นทางเปลี่ยนชื่อหรือน้ำหนัก กรุณาตรวจคู่สินค้าใหม่'`,
      [source.id, JSON.stringify(rows)]);
  }

  /**
   * Reads the first pending listing to the end in ONE browser session (see PublicWebReader.paginate): no
   * per-tick page cap, the lease is renewed on every page, and a night-only source pauses when the night
   * window closes (status stays 'running'; the next night resumes). Visited entries are `<listing>#page=N`,
   * so page counts and maxPages work as for links.
   * ponytail: resuming re-clicks from page 1 to where it stopped (≈1–2 s per click), only after a pause or crash.
   */
  /**
   * `ignoreNight`: run now even for a night-only site (first look, or a person asked to collect now).
   * `firstLookPages`: pause (still running) after that many pages; the rest continues in the night window.
   */
  private async pagedBatch(id: string, source: ScrapingSource, lease: { until: Date }, { firstLookPages, ignoreNight }: PagedRunOptions = {}) {
    const listing = source.progress.pending[0];
    if (!listing || source.progress.visited.length >= source.config.maxPages) return;
    const tag = `${listing}#page=`;
    const done = source.progress.visited.filter(entry => entry.startsWith(tag)).length;
    const owned = (current: ScrapingSource | null): current is ScrapingSource => !!current && current.status === 'running'
      && current.revision === source.revision && current.leaseUntil?.getTime() === lease.until.getTime();
    const seen = new Set<string>();
    let finished = false;
    let interrupted = false; // paused for the night window, stopped, or lease lost — not "listing ended"
    let error: string | null = null;
    let totalPages: number | null = null;
    try {
      const result = await this.reader.paginate(listing, source.config, source.origin, {
        skip: done, maxPages: source.config.maxPages - source.progress.visited.length + done,
        // One browser session clicks "next": each page already waits for the site's own request, so 1 s on top is enough.
        delayMs: Math.min(source.config.delayMs, PAGED_DELAY_MS), login: this.siteLogin(source),
        // Clicking back to where it stopped saves no page, so it keeps the lease alive (without that, after 10 min
        // another run claimed the source and started clicking from page 1 again — "stuck") and shows how far it got.
        onSkip: async index => {
          if ((index + 1) % 20) return true;
          const until = new Date(Date.now() + pagedLeaseMs);
          const renewed = await this.sources.createQueryBuilder().update()
            .set({ leaseUntil: until, progress: () => `jsonb_set(progress, '{catchUp}', to_jsonb(CAST(:reached AS int)))` })
            .where('id = :id AND status = :status AND revision = :revision AND lease_until = :lease', { id, status: 'running', revision: source.revision, lease: lease.until })
            .setParameter('reached', index + 1).execute();
          if (!renewed.affected) { interrupted = true; return false; }
          lease.until = until;
          return true;
        },
        onPage: (html, url, index) => this.sources.manager.transaction(async manager => {
          const repository = manager.getRepository(ScrapingSource);
          const current = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
          if (!owned(current) || (source.config.nightOnly && !ignoreNight && !inNightWindow()) || !(await this.automation()).enabled) { interrupted = true; return false; }
          const fresh = this.reader.extract(html, url, source.config).items.filter(item => !seen.has(item.url));
          fresh.forEach(item => seen.add(item.url));
          current.progress.items += await this.saveItems(manager, source, fresh);
          current.progress.visited.push(`${tag}${index + 1}`);
          current.progress.successful += 1;
          delete current.progress.catchUp;
          // Back on track after a drop: a give-up never drops the listing, so its failure is now recovered too.
          if (current.progress.retries) { current.progress.retries = 0; current.progress.failed = 0; current.lastError = null; }
          current.leaseUntil = new Date(Date.now() + pagedLeaseMs);
          const pause = !!firstLookPages && index + 1 - done >= firstLookPages; // rest at night
          if (pause) delete current.progress.now;
          await repository.save(current);
          lease.until = current.leaseUntil;
          if (pause) { interrupted = true; return false; }
          // A page that repeats what we already read means paging ended (site ignored the next control).
          // The session's first page may still be empty while a script-rendered list loads (Lotus's); a truly
          // empty listing then ends with 'no next page' instead.
          return fresh.length > 0 || index === done;
        }),
      });
      finished = !interrupted && result.end !== 'limit';
      totalPages = result.totalPages;
      // "Next" did not move long before the site's own last page: a dropped click or slow load, not the end.
      const expected = source.config.expectedPages ?? totalPages;
      const read = result.pages; // absolute page number, skipped pages included
      if (finished && result.end === 'no-next' && expected && read < expected * 0.95) {
        error = `หน้าถัดไปไม่ขึ้นที่หน้า ${read.toLocaleString('th-TH')} จาก ~${expected.toLocaleString('th-TH')}`;
      }
    } catch (err) {
      error = err instanceof BadRequestException ? err.message : 'อ่านหน้ารายการไม่สำเร็จ ลองสำรวจเว็บใหม่';
      finished = true;
    }
    await this.sources.manager.transaction(async manager => {
      const repository = manager.getRepository(ScrapingSource);
      const current = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!owned(current)) return;
      const progress = current.progress;
      // A drop keeps the listing pending: the next run resumes from the page it reached. Up to MAX_RETRIES on its
      // own (the tick claims it again once the backoff lease ends), then it waits for a person ("เก็บต่อ").
      const retries = progress.retries ?? 0;
      const dropped = !!error;
      if (dropped) {
        progress.retries = retries + 1;
        error = retries < MAX_RETRIES ? `${error} — หลุดระหว่างเก็บ กำลังลองใหม่เอง (ครั้งที่ ${retries + 1}/${MAX_RETRIES})`
          : `${error} — ลองใหม่ ${MAX_RETRIES} ครั้งแล้วไม่สำเร็จ กด “เก็บต่อเลยตอนนี้” เพื่อเก็บต่อจากหน้าที่ค้าง`;
        if (retries >= MAX_RETRIES) progress.failed += 1; // a drop that recovered is not a failure
      } else if (finished) progress.pending.shift();
      // The site's own page count, once seen, drives "อ่านแล้ว X จาก ~Y หน้า" and the page cap.
      if (totalPages && !current.config.expectedPages) current.config = { ...current.config, expectedPages: totalPages, maxPages: Math.min(5000, Math.max(totalPages, progress.visited.length)) };
      if (finished && !error && progress.visited.filter(entry => entry.startsWith(tag)).length <= 1) {
        error = 'อ่านได้หน้าเดียว ไม่พบหน้าถัดไป — ลิงก์เริ่มต้นอาจไม่ใช่หน้ารายการ ใช้ “ลองดึงข้อมูล” กับลิงก์หน้าค้นหาหรือหมวดสินค้า';
      }
      current.lastError = error || current.lastError;
      current.status = dropped && retries >= MAX_RETRIES ? 'limited'
        : !progress.pending.length ? (progress.failed || current.lastError ? 'limited' : 'completed') : progress.visited.length >= source.config.maxPages ? 'limited' : 'running';
      if (current.status !== 'running') delete progress.now;
      delete progress.catchUp;
      // Free the lease now (or after the retry backoff) instead of waiting out the 10-minute paged lease.
      current.leaseUntil = dropped && current.status === 'running' ? new Date(Date.now() + 30000 * progress.retries!) : null;
      await repository.save(current);
    });
  }

}

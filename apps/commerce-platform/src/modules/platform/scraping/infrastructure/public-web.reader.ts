import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'node:https';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { chromium } from 'playwright';
import { ScrapingConfig } from '../domain/scraping-source.entity';
import { parseSideQuantity } from '../../../shared-kernel/helpers/avg-price.helper';

export function extractedWeightKg(name: string): number | null {
  // ponytail: explicit single weights only; multipacks/ranges require a person to confirm.
  if (/\d\s*[-–]\s*\d|[x×]\s*\d|\d\s*(แพ็ก|แพ็ค|ชิ้น|ถุง)\s*\//i.test(name)) return null;
  const matches = [...name.matchAll(/(\d+(?:\.\d+)?)\s*(กิโลกรัม|กก\.?|กรัม|kg|gm|g)(?![a-z])/gi)];
  if (matches.length !== 1) return null;
  const [, value, rawUnit] = matches[0];
  const unit = /^(กิโลกรัม|กก\.?|kg)$/i.test(rawUnit) ? 'KG' : 'G';
  const parsed = parseSideQuantity(`${value} ${unit}`);
  const weight = parsed ? parsed.value / (unit === 'G' ? 1000 : 1) : null;
  return weight != null && weight >= 0.0001 && weight <= 100000 ? weight : null;
}

export function publicUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new BadRequestException('ลิงก์เว็บไม่ถูกต้อง'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2000
    || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.') || /\.(localhost|local|internal)$/i.test(url.hostname)) {
    throw new BadRequestException('ใช้ HTTPS ของเว็บสาธารณะ ไม่ระบุบัญชี พอร์ต หรือ IP');
  }
  url.hash = '';
  return url;
}
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Global unicast only; reject mapped IPv4, local, multicast and tunnelling ranges.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address)
    && !/^2001:(?:0*:|db8:)/i.test(address) && !/^2002:/i.test(address);
}
export function scrapingVersion(config: ScrapingConfig): string {
  return createHash('sha256').update(JSON.stringify([config.mode, config.itemSelector, config.fields, config.currency, config.vatIncluded, config.priceContext, config.selectedFields])).digest('hex');
}
export function resolveWebsite(input: string): { name: string; url: URL } {
  const aliases: Record<string, [string, string]> = {
    makro: ['Makro PRO', 'https://www.makro.pro'], makropro: ['Makro PRO', 'https://www.makro.pro'],
    แม็คโคร: ['Makro PRO', 'https://www.makro.pro'], แมคโคร: ['Makro PRO', 'https://www.makro.pro'],
    bigc: ['Big C', 'https://www.bigc.co.th'], บิ๊กซี: ['Big C', 'https://www.bigc.co.th'],
    freshket: ['Freshket', 'https://freshket.co'], เฟรชเก็ต: ['Freshket', 'https://freshket.co'],
  };
  const value = input.trim();
  const known = aliases[value.toLowerCase().replace(/\s+/g, '')];
  if (!known && !value.includes('.')) throw new BadRequestException('ไม่พบชื่อเว็บนี้ กรุณาใส่โดเมนหรือลิงก์ เช่น example.com');
  const url = publicUrl(known?.[1] || (/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`));
  return { name: known?.[0] || url.hostname, url };
}
export const discoveredFieldLabels: Record<string, string> = {
  name: 'ชื่อสินค้า / ชื่อรายการ', title: 'ชื่อรายการ', url: 'ลิงก์ต้นทาง', price: 'ราคาขาย', regularPrice: 'ราคาปกติ',
  sku: 'รหัสสินค้า', weight: 'น้ำหนัก', brand: 'แบรนด์', category: 'หมวดหมู่', image: 'รูปภาพ', description: 'รายละเอียด',
  currency: 'สกุลเงิน', availability: 'สถานะสินค้า', countryOfOrigin: 'ประเทศต้นทาง', gtin13: 'บาร์โค้ด',
  author: 'ผู้เขียน', datePublished: 'วันที่เผยแพร่', priceType: 'เงื่อนไขราคา',
};
export function singlePrice(text: string | undefined): number | null {
  if (!text || !/^\s*(?:฿|THB|บาท)?\s*\d+(?:,\d{3})*(?:\.\d{1,2})?\s*(?:฿|THB|บาท)?\s*$/i.test(text)) return null;
  const value = Number(text.replace(/฿|THB|บาท|,|\s/gi, ''));
  return value > 0 && value <= 9999999999.99 ? value : null;
}
export type ExtractedWebItem = { url: string; pageUrl: string; name: string; sku: string; fields: Record<string, string>; price: number | null; currency: string };

@Injectable()
export class PublicWebReader {
  async fetch(input: string, expectedOrigin?: string): Promise<{ body: Buffer; url: string; contentType: string }> {
    let url = publicUrl(input);
    const deadline = Date.now() + 15000;
    for (let redirect = 0; redirect <= 5; redirect++) {
      if (Date.now() >= deadline) throw new BadRequestException('เว็บตอบช้าเกินเวลาที่กำหนด กรุณาลองใหม่');
      if (expectedOrigin && url.origin !== expectedOrigin) throw new BadRequestException('ลิงก์เปลี่ยนไปเว็บอื่น กรุณาตรวจแหล่งที่มา');
      let dnsTimer: NodeJS.Timeout | undefined;
      const addresses = await Promise.race([lookup(url.hostname, { all: true }), new Promise<never>((_resolve, reject) => {
        dnsTimer = setTimeout(() => reject(new BadRequestException('ค้นหาโดเมนไม่สำเร็จภายในเวลา กรุณาลองใหม่')), Math.min(5000, Math.max(1, deadline - Date.now())));
      })]).finally(() => { if (dnsTimer) clearTimeout(dnsTimer); });
      if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new BadRequestException('เว็บนี้ชี้ไปเครือข่ายส่วนตัวหรือ IP ที่ไม่อนุญาต');
      const pinned = addresses[0];
      const agent = new Agent({ lookup: (_host, options, callback) => {
        // Pin the validated answer: a second DNS lookup would allow rebinding.
        if ((options as { all?: boolean }).all) (callback as Function)(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      } });
      try {
        const response = await axios.get<Buffer>(url.href, { httpsAgent: agent, proxy: false, maxRedirects: 0,
          responseType: 'arraybuffer', timeout: Math.max(1, deadline - Date.now()), maxContentLength: 5000000, maxBodyLength: 5000000,
          headers: { 'User-Agent': 'CommercePlatformCatalog/1.0', Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*;q=0.5' },
          validateStatus: status => status >= 200 && status < 400 });
        if (response.status >= 300) {
          if (!response.headers.location || redirect === 5) throw new BadRequestException('เว็บเปลี่ยนลิงก์หลายครั้งหรือไม่มีปลายทาง');
          url = publicUrl(new URL(String(response.headers.location), url).href);
          continue;
        }
        return { body: Buffer.from(response.data), url: url.href, contentType: String(response.headers['content-type'] ?? '') };
      } finally { agent.destroy(); }
    }
    throw new BadRequestException('เปิดลิงก์ไม่สำเร็จ');
  }

  async page(input: string, config: ScrapingConfig, origin: string): Promise<{ html: string; url: string }> {
    if (config.mode === 'html' || /\.xml(?:\?|$)/i.test(input)) {
      const response = await this.fetch(input, origin);
      if (!/html|xml/i.test(response.contentType)) throw new BadRequestException('หน้านี้ไม่ใช่ HTML หรือ XML');
      return { html: response.body.toString('utf8'), url: response.url };
    }
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-background-networking'] })
      .catch(() => { throw new BadRequestException('เบราว์เซอร์ยังไม่พร้อมบนเซิร์ฟเวอร์ ให้ผู้ดูแลติดตั้ง Chromium หรือลองโหมด HTML'); });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      let requests = 0;
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.route('**/*', async route => {
        try {
          if (++requests > 150 || !['GET', 'HEAD'].includes(route.request().method()) || ['image', 'media', 'font'].includes(route.request().resourceType())) return await route.abort();
          const response = await this.fetch(route.request().url(), route.request().isNavigationRequest() ? origin : undefined);
          if (route.request().isNavigationRequest() && response.url !== route.request().url()) {
            return await route.fulfill({ status: 302, headers: { location: response.url } });
          }
          // No credentials/cookies are forwarded, including cookies set by the site.
          await route.fulfill({ status: 200, body: response.body, contentType: response.contentType });
        } catch { await route.abort().catch(() => undefined); }
      });
      const page = await context.newPage();
      context.on('page', popup => { if (popup !== page) void popup.close(); });
      const response = await page.goto(input, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (!response?.ok() || publicUrl(page.url()).origin !== origin) throw new BadRequestException('เปิดหน้าเว็บไม่ได้');
      const selector = config.itemSelector || config.fields.find(f => f.key === 'name')?.selector;
      if (selector) await page.locator(selector).first().waitFor({ timeout: 10000 });
      else await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
      const html = await page.content();
      if (Buffer.byteLength(html) > 5000000) throw new BadRequestException('หน้าเว็บใหญ่เกิน 5 MB');
      return { html, url: page.url() };
    } finally { await browser.close(); }
  }

  extract(html: string, pageUrl: string, config: ScrapingConfig): { items: ExtractedWebItem[]; links: string[]; sitemap: boolean } {
    const xml = /^\s*(?:<\?xml[^>]*>\s*)?<(?:urlset|sitemapindex)\b/i.test(html);
    const dom = new JSDOM(html, { url: pageUrl, ...(xml ? { contentType: 'text/xml' } : {}) });
    try {
      const document = dom.window.document;
      const links = [...document.querySelectorAll(xml ? 'loc' : 'a[href]')].slice(0, 10000).map(e => xml ? e.textContent?.trim() : e.getAttribute('href')).filter(Boolean) as string[];
      if (xml) return { items: [], links, sitemap: true };
      const items: ExtractedWebItem[] = [];
      const add = (raw: Record<string, string>) => {
        const fields = config.selectedFields ? Object.fromEntries(Object.entries(raw).filter(([key]) => config.selectedFields!.includes(key) || ['name', 'title', 'url'].includes(key))) : raw;
        const name = (fields.name || fields.title || '').trim();
        if (!name) return;
        let url: URL;
        try { url = publicUrl(new URL(fields.url || pageUrl, pageUrl).href); } catch { return; }
        if (url.origin !== new URL(pageUrl).origin) return;
        const price = singlePrice(fields.price);
        const regularPrice = singlePrice(raw.regularPrice);
        const gated = /member|สมาชิก|coupon|คูปอง/i.test(raw.priceType || '');
        items.push({ url: url.href, pageUrl, name: name.slice(0, 500), sku: (fields.sku || '').slice(0, 100), fields,
          price: gated || (raw.regularPrice && (regularPrice == null || regularPrice !== price)) ? null : price,
          currency: raw.currency || config.currency });
      };
      if (config.fields.length) {
        const roots = config.itemSelector ? [...document.querySelectorAll(config.itemSelector)] : [document];
        if (roots.length > 1 && !config.fields.some(f => f.key === 'url')) throw new BadRequestException('หน้ารายการหลายสินค้า ต้องตั้งฟิลด์ url เพื่อแยกแต่ละรายการ');
        for (const root of roots.slice(0, 500)) {
          const fields: Record<string, string> = Object.create(null);
          for (const field of config.fields) {
            const element = field.selector === ':scope' && root !== document ? root as Element : root.querySelector(field.selector);
            let value = (field.attribute ? element?.getAttribute(field.attribute) : element?.textContent)?.trim() || '';
            if (['url', 'image'].includes(field.key) && value) { try { value = new URL(value, pageUrl).href; } catch { value = ''; } }
            fields[field.key] = value.replace(/\s+/g, ' ').slice(0, 5000);
          }
          add(fields);
        }
      } else {
        // JSON-LD is a default extraction path; CSS mappings override it explicitly.
        const products: Record<string, any>[] = [];
        const walk = (value: unknown, depth = 0) => {
          if (depth > 12 || !value || typeof value !== 'object') return;
          if (Array.isArray(value)) { value.slice(0, 1000).forEach(v => walk(v, depth + 1)); return; }
          const object = value as Record<string, any>;
          if ([object['@type']].flat().includes('Product')) products.push(object);
          Object.values(object).forEach(v => walk(v, depth + 1));
        };
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try { walk(JSON.parse(script.textContent || '')); } catch { /* Invalid structured data leaves the preview empty. */ }
        }
        for (const product of products.slice(0, 500)) {
          if (products.length > 1 && typeof product.url !== 'string') continue;
          const offers = [product.offers].flat().filter(Boolean);
          const offer = offers.length === 1 ? offers[0] : {};
          const specifications = [offer.priceSpecification].flat().filter(Boolean);
          const extras: Record<string, string> = Object.create(null);
          for (const [key, value] of Object.entries(product)) {
            if (!/^[a-z][a-zA-Z0-9_]{0,39}$/.test(key) || ['constructor', 'prototype', 'offers', 'additionalProperty'].includes(key)) continue;
            const scalar = typeof value === 'string' || typeof value === 'number' ? String(value)
              : value && typeof value === 'object' && typeof value.name === 'string' ? value.name : '';
            if (scalar) extras[key] = scalar.slice(0, 5000);
          }
          if (product.weight?.value != null) {
            const unit = product.weight.unitText || ({ KGM: 'kg', GRM: 'g' } as Record<string, string>)[product.weight.unitCode];
            if (unit) extras.weight = `${product.weight.value} ${unit}`;
          }
          for (const [index, property] of [product.additionalProperty].flat().filter(Boolean).slice(0, 5).entries()) {
            if (property.name && ['string', 'number'].includes(typeof property.value)) extras[`detail${index + 1}`] = `${property.name}: ${property.value}`.slice(0, 5000);
          }
          const image = [product.image].flat().find(value => typeof value === 'string' || value?.url);
          add({ ...extras, name: typeof product.name === 'string' ? product.name : '', sku: String(product.sku || ''), url: typeof product.url === 'string' ? product.url : pageUrl,
            price: typeof offer.price === 'string' || typeof offer.price === 'number' ? String(offer.price) : '', currency: String(offer.priceCurrency || config.currency),
            priceType: offer.validForMemberTier || specifications.some(spec => spec.validForMemberTier) ? 'member' : '',
            availability: String(offer.availability || ''), image: typeof image === 'string' ? image : image?.url || '',
            description: typeof product.description === 'string' ? product.description.slice(0, 5000) : '' });
        }
      }
      const identities = new Map<string, string>();
      for (const item of items) {
        const identity = JSON.stringify([item.name, item.sku, item.price, item.fields.weight]);
        if (identities.has(item.url) && identities.get(item.url) !== identity) throw new BadRequestException('พบหลายรายการใช้ลิงก์เดียวกัน ต้องตั้ง url ที่แยก SKU หรือตัวเลือกสินค้า');
        identities.set(item.url, identity);
      }
      return { items: [...new Map(items.map(item => [item.url, item])).values()], links, sitemap: false };
    } finally { dom.window.close(); }
  }

  inspect(html: string, pageUrl: string, base: ScrapingConfig) {
    const structured = this.extract(html, pageUrl, { ...base, fields: [], selectedFields: undefined });
    const dom = new JSDOM(html, { url: pageUrl });
    try {
      const document = dom.window.document;
      const title = document.title.trim().slice(0, 200);
      if (structured.items.length) return { title, kind: 'product' as const, config: { ...base, fields: [] }, ...structured };
      const rootSelector = ['[itemtype$="/Product"]', '[data-product-id]', '[data-testid*="product-card"]', '[class*="product-card"]', 'article', 'tbody tr']
        .find(selector => document.querySelectorAll(selector).length > 1);
      const root = rootSelector ? document.querySelector(rootSelector)! : document;
      const fields: ScrapingConfig['fields'] = [];
      const selectorFor = (element: Element): string => {
        for (const attribute of ['itemprop', 'data-field', 'data-testid', 'id']) {
          const value = element.getAttribute(attribute);
          if (value && /^[a-zA-Z0-9_.-]{1,100}$/.test(value)) {
            const selector = `[${attribute}="${value}"]`;
            if (rootSelector && ['id', 'data-testid'].includes(attribute)
              && Array.from<Element>(document.querySelectorAll(rootSelector)).slice(0, 10).some(item => !item.querySelector(selector))) continue;
            return selector;
          }
        }
        const classes = Array.from(element.classList).filter(value => /^[a-zA-Z][a-zA-Z_-]{1,39}$/.test(value)).slice(0, 3);
        if (classes.length) {
          const selector = element.tagName.toLowerCase() + classes.map(value => `.${value}`).join('');
          if (root.querySelectorAll(selector).length === 1) return selector;
        }
        const path: string[] = [];
        let current: Element | null = element;
        while (current && current !== root && path.length < 6) {
          const siblings: Element[] = current.parentElement ? Array.from(current.parentElement.children).filter(e => e.tagName === current!.tagName) : [];
          path.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(current) + 1)})`);
          current = current.parentElement;
        }
        return path.join(' > ').slice(0, 300);
      };
      const add = (key: string, selector: string, attribute?: string, label?: string) => {
        const element = root.querySelector(selector);
        if (!element || fields.some(field => field.key === key) || fields.length >= 20) return;
        const actualAttribute = element.tagName === 'META' ? 'content' : attribute;
        const value = actualAttribute ? element.getAttribute(actualAttribute) : element.textContent;
        if (value?.trim()) fields.push({ key, label: label || discoveredFieldLabels[key] || key, selector: selectorFor(element), ...(actualAttribute ? { attribute: actualAttribute } : {}) });
      };
      if (rootSelector === 'tbody tr') {
        const headers = [...document.querySelectorAll('thead th')];
        headers.slice(0, 16).forEach((header, index) => {
          const label = header.textContent?.trim() || `คอลัมน์ ${index + 1}`;
          const key = /price|ราคา/i.test(label) ? 'price' : /sku|รหัส/i.test(label) ? 'sku' : /name|title|ชื่อ/i.test(label) || index === 0 ? 'name' : `column${index + 1}`;
          add(key, `td:nth-child(${index + 1})`, undefined, label);
        });
      }
      for (const selector of ['[itemprop="name"]', '[data-field="name"]', 'h1', 'h2', 'h3', 'a[title]']) add('name', selector);
      if (rootSelector && !fields.some(f => f.key === 'name')) add('name', 'a[href]');
      add('price', '[itemprop="price"], [data-field="price"], [data-testid="price"], .price');
      add('regularPrice', '[data-field="regularPrice"], .regular-price, .old-price, del, s');
      add('image', '[itemprop="image"], img[src]', 'src');
      for (const selector of ['a[itemprop="url"]', 'a[rel="bookmark"]', 'h2 a[href]', 'h3 a[href]', 'a[href]']) add('url', selector, 'href');
      for (const key of ['sku', 'brand', 'weight', 'description', 'category', 'availability', 'currency', 'countryOfOrigin', 'author', 'datePublished', 'gtin13']) {
        add(key, `[itemprop="${key}"], [data-field="${key}"]`);
      }
      for (const element of root.querySelectorAll('[data-field]')) {
        const key = element.getAttribute('data-field') || '';
        if (/^[a-z][a-zA-Z0-9_]{0,39}$/.test(key) && !['constructor', 'prototype'].includes(key)) add(key, `[data-field="${key}"]`, undefined, element.getAttribute('data-label') || undefined);
      }
      if (!rootSelector) {
        // A page record is useful for articles/general data, but must not be mistaken for a product.
        // A category heading and a price elsewhere in the document do not identify one product.
        for (let index = fields.length - 1; index >= 0; index--) {
          if (['price', 'regularPrice'].includes(fields[index].key)) fields.splice(index, 1);
        }
        const name = fields.find(f => f.key === 'name');
        if (!name) add('name', 'meta[property="og:title"], title');
        add('description', 'meta[name="description"], meta[property="og:description"]');
        const url = fields.findIndex(f => f.key === 'url');
        if (url >= 0) fields.splice(url, 1); // Single records use their page URL, never a navigation link.
      }
      const config = { ...base, fields, itemSelector: rootSelector || '' };
      const result = fields.some(field => field.key === 'name') ? this.extract(html, pageUrl, config) : { ...structured, items: [] };
      return { title, kind: rootSelector ? 'list' as const : 'page' as const, config, ...result };
    } finally { dom.window.close(); }
  }
}

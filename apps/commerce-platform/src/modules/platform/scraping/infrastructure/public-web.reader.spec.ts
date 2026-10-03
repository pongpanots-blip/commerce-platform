import axios from 'axios';
import { PublicWebReader, isPublicAddress, publicUrl, singlePrice, resolveWebsite, cardFields } from './public-web.reader';
import { ScrapingConfig } from '../domain/scraping-source.entity';

it('pins public DNS, rejects redirects into private networks, and extracts generic mapped fields without ambiguous prices', async () => {
  const reader = new PublicWebReader();
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1', '2002:7f00:1::']) expect(isPublicAddress(address)).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true); expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://a.local', 'https://a:b@example.com', 'https://example.com:8443']) expect(() => publicUrl(url)).toThrow();
  for (const price of ['120 150', '120 / kg', 'สมาชิก 120', '99-120', '1,23', '0']) expect(singlePrice(price)).toBeNull();
  expect(singlePrice('฿1,200.50')).toBe(1200.5);
  const config: ScrapingConfig = { startUrls: ['https://example.com/list'], pathPrefixes: ['/'], mode: 'html', itemSelector: '.item',
    fields: [{ key: 'name', label: 'ชื่อ', selector: 'h2' }, { key: 'price', label: 'ราคา', selector: '.price' },
      { key: 'url', label: 'ลิงก์', selector: 'a', attribute: 'href' }, { key: 'quality', label: 'เกรด', selector: '.quality' }],
    currency: 'THB', vatIncluded: true, priceContext: 'ราคาปกติ', collectionAllowed: true, intervalHours: 24, maxPages: 100, delayMs: 1000 };
  const html = '<article class="item"><h2>เนื้อ 1 kg</h2><a href="/meat">ดู</a><b class="price">120 บาท</b><p class="quality">เกรด A</p></article><article class="item"><h2>เห็ด</h2><a href="/mushroom">ดู</a><b class="price">99 120</b></article>';
  expect(reader.extract(html, 'https://example.com/list', config).items).toMatchObject([
    { name: 'เนื้อ 1 kg', url: 'https://example.com/meat', price: 120, fields: { quality: 'เกรด A' } }, { name: 'เห็ด', price: null },
  ]);
  expect(() => reader.extract(html, 'https://example.com/list', { ...config, fields: config.fields.filter(f => f.key !== 'url') })).toThrow('หลายสินค้า');
  expect(() => reader.extract(html.replace('/mushroom', '/meat'), 'https://example.com/list', config)).toThrow('ลิงก์เดียวกัน');
  const lookup = jest.spyOn(jest.requireActual<typeof import('node:dns/promises')>('node:dns/promises'), 'lookup');
  const get = jest.spyOn(axios, 'request');
  try {
    lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    get.mockImplementationOnce(async (options: any) => {
      const result = await new Promise(resolve => options?.httpsAgent.options.lookup('example.com', {}, (_error: unknown, address: string) => resolve(address)));
      expect(result).toBe('8.8.8.8'); expect(options?.maxRedirects).toBe(0); expect(options?.proxy).toBe(false);
      return { status: 302, headers: { location: 'https://private.example.com/secret' } };
    });
    lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as never).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(reader.fetch('https://example.com/list')).rejects.toThrow('เครือข่ายส่วนตัว');
    expect(get).toHaveBeenCalledTimes(1);
  } finally { lookup.mockRestore(); get.mockRestore(); }
});

it('discovers structured/card/table fields and applies field selection without dropping public-price checks', () => {
  const reader = new PublicWebReader();
  const config: ScrapingConfig = { startUrls: [], pathPrefixes: ['/'], mode: 'html', itemSelector: '', fields: [], currency: 'THB', vatIncluded: false,
    priceContext: 'ข้อมูลสาธารณะ', collectionAllowed: true, intervalHours: 24, maxPages: 100, delayMs: 1000 };
  expect(resolveWebsite('Big C').url.href).toBe('https://www.bigc.co.th/');
  expect(resolveWebsite('Makro PRO').name).toBe('Makro PRO');
  expect(resolveWebsite('freshket').url.href).toBe('https://freshket.co/');
  expect(resolveWebsite('example.com/products').url.href).toBe('https://example.com/products');
  expect(() => resolveWebsite('https://127.0.0.1')).toThrow();
  const product = { '@type': 'Product', name: 'เนื้อ 1 kg', sku: 'SKU1', brand: { name: 'Farm' }, weight: { value: 1, unitCode: 'KGM' },
    offers: { price: 120, priceCurrency: 'THB', availability: 'https://schema.org/InStock' }, description: 'รายละเอียดจากเว็บ', image: ['https://example.com/meat.jpg'] };
  const html = `<script type="application/ld+json">${JSON.stringify(product)}</script>`;
  const inspection = reader.inspect(html, 'https://example.com/product/meat', config);
  expect(inspection).toMatchObject({ kind: 'product', items: [{ fields: { brand: 'Farm', weight: '1 kg', description: 'รายละเอียดจากเว็บ', image: 'https://example.com/meat.jpg' } }] });
  const selected = { ...config, selectedFields: ['name', 'url', 'price'] };
  expect(reader.extract(html, 'https://example.com/product/meat', selected).items[0].fields.description).toBeUndefined();
  const member = `<script type="application/ld+json">${JSON.stringify({ ...product, offers: { ...product.offers, validForMemberTier: 'members' } })}</script>`;
  expect(reader.extract(member, 'https://example.com/product/meat', selected).items[0].price).toBeNull();
  const cards = '<article class="product-card"><h2>เนื้อ 1 kg</h2><a href="/products/meat">ดู</a><span class="price">120 บาท</span><p data-field="quality" data-label="เกรด">เกรด A</p></article><article class="product-card"><h2>หมู 1 kg</h2><a href="/products/pork">ดู</a><span class="price">100 บาท</span><p data-field="quality">เกรด B</p></article>';
  const listing = reader.inspect(cards, 'https://example.com/catalog', config);
  expect(listing).toMatchObject({ kind: 'list', items: [{ url: 'https://example.com/products/meat', price: 120 }, { url: 'https://example.com/products/pork', price: 100 }] });
  expect(listing.config.fields.find(field => field.key === 'quality')?.label).toBe('เกรด');
  const table = reader.inspect('<table><thead><tr><th>ชื่อ</th><th>ราคา</th><th>เกรด</th></tr></thead><tbody><tr><td><a href="/a">เนื้อ</a></td><td>120</td><td>A</td></tr><tr><td><a href="/b">หมู</a></td><td>100</td><td>B</td></tr></tbody></table>', 'https://example.com/table', config);
  expect(table.items).toHaveLength(2); expect(table.items[0].fields.column3).toBe('A');
});

it('finds product cards from repeated links without CSS selectors (Makro-like markup)', () => {
  const card = (id: string, name: string, price: string, extra = '') => `<div><a href="/p/${id}?info=pos${id}"><div>
    <img src="/_next/static/media/apple.png"><img src="data:image/gif;base64,R0lGOD"><img srcset="https://img.example.com/${id}.jpg 1x">
    <span>${name}</span><span>&lt;truckIcon /&gt;</span>${extra}<span>฿</span><span>${price}</span></div></a></div>`;
  const html = `<html><body><nav><a href="/about">About</a></nav><main>
    ${card('a1', 'น่องไก่ 1 กก.', '95', '<span>95.00 ฿ ต่อหน่วย หน่วย</span>')}
    ${card('a2', 'เครื่องดื่มเกลือแร่ 250 มล. x 24', '252')}
    ${card('a3', 'แครอท 1 กก.', '1,250.50', '<span>แม็คโคร</span>')}</main></body></html>`;
  const { JSDOM } = require('jsdom');
  const cards = cardFields(new JSDOM(html, { url: 'https://shop.example.com/c/search?q=*' }).window.document, 'https://shop.example.com/c/search?q=*');
  expect(cards.map(c => [c.url, c.name, c.price])).toEqual([
    ['https://shop.example.com/p/a1', 'น่องไก่ 1 กก.', '฿95'],
    ['https://shop.example.com/p/a2', 'เครื่องดื่มเกลือแร่ 250 มล. x 24', '฿252'],
    ['https://shop.example.com/p/a3', 'แครอท 1 กก.', '฿1250.5'],
  ]);
  expect(cards[0].unitPrice).toBe('95.00 ฿ ต่อหน่วย หน่วย');
  expect(cards[0].image).toBe('https://img.example.com/a1.jpg');
  expect(cards[2].details).toBe('แม็คโคร');
  expect(cards.some(c => c.regularPrice)).toBe(false);
});

it('does not assign a category heading the first unrelated price on the page', () => {
  const reader = new PublicWebReader();
  const config: ScrapingConfig = { startUrls: [], pathPrefixes: ['/'], mode: 'html', itemSelector: '', fields: [], currency: 'THB', vatIncluded: true,
    priceContext: 'ราคาปกติ', collectionAllowed: true, intervalHours: 24, maxPages: 1, delayMs: 1000 };
  const html = '<h1>Beef</h1><div><h2>Ground beef 1 kg</h2><span class="price">฿199</span><del>250</del></div><div><h2>Steak 1 kg</h2><span class="price">฿750</span></div>';
  const page = reader.inspect(html, 'https://example.com/category/beef', config);
  expect(page.kind).toBe('page');
  expect(page.config.fields.map(field => field.key)).not.toContain('price');
  expect(page.config.fields.map(field => field.key)).not.toContain('regularPrice');
  expect(page.items).toMatchObject([{ name: 'Beef', price: null }]);
});

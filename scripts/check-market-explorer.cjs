#!/usr/bin/env node
// Run: node scripts/check-market-explorer.cjs (isolated DOM and mocked API; no live writes).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('@swc/core');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLDialogElement']) global[key] = key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key];
global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout; give the real Leaflet map a viewport for fitBounds.
for (const [key, size] of [['clientWidth', 800], ['clientHeight', 360]]) Object.defineProperty(dom.window.HTMLElement.prototype, key, { get() { return this.classList.contains('market-map-canvas') ? size : 0; } });
// jsdom has no native dialog implementation; exercise the component's open/close event wiring.
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  module._compile(transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'typescript', tsx: extension === '.tsx' }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  }).code, filename);
};
require.extensions['.css'] = () => {};

const restaurant = { id: 'restaurant-1', name: 'ร้านทดสอบ', nameTh: 'ร้านทดสอบ', nameEn: null, district: 'วัฒนา', category: 'cafe',
  lat: 13.74, lng: 100.54, rating: null, reviewCount: null, priceRange: null, isEnriched: false, popularTimesToday: null,
  estimatedTables: null, winbackAccountId: 'linked-account', winbackCustomerCode: null };
const htmlName = '<img src=x onerror="alert(1)"> ร้านทดสอบ';
const firstPage = [restaurant, { ...restaurant, id: 'html-name', name: htmlName, lat: 13.75, lng: 100.55 },
  ...[[0, 0], [91, 100], [13, 181], [NaN, 100]].map(([lat, lng], index) => ({ ...restaurant, id: `invalid-${index}`, lat, lng }))];
const pageTwo = { ...restaurant, id: 'page-2', name: 'ร้านหน้าสอง' };
const filtered = { ...restaurant, id: 'filtered', name: 'ร้านผลค้นหา' };
const calls = [];
let detailId, resolveDetail;
const marketApi = {
  restaurants: async filters => { calls.push({ ...filters }); return { items: filters.search ? [filtered] : filters.page === 2 ? [pageTwo] : firstPage, page: filters.page, limit: filters.limit, summary: { totalCount: 41, topCategories: [], topDistricts: [] } }; },
  restaurant: id => { detailId = id; return new Promise(resolve => { resolveDetail = resolve; }); },
};
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === '../../lib/api' && parent.filename.endsWith('MarketExplorer.tsx')) return { marketApi };
  return load.call(this, request === '@cp/ui' ? path.resolve(__dirname, '../libs/ui/src/index.tsx') : request, parent, ...rest);
};
const React = require('react');
const { createRoot } = require('react-dom/client');
const { MarketExplorer } = require('../apps/commerce-admin/src/app/pages/MarketExplorer.tsx');
Module._load = load;
const root = createRoot(document.getElementById('root'));
const click = async selector => {
  const element = document.querySelector(selector);
  assert.ok(element, `Missing ${selector}`);
  await React.act(async () => element.click());
};

(async () => {
  try {
    await React.act(async () => root.render(React.createElement(MarketExplorer)));
    assert.equal(calls.at(-1).page, 1);
    assert.match(document.querySelector('.market-sales').textContent, /มีในรายชื่อแล้ว/, 'Account identity determines linked status even without a customer code');
    const pins = () => [...document.querySelectorAll('.market-map-pin')];
    assert.equal(pins().length, 2, 'Missing, nonfinite, and out-of-range coordinates produce no pins');
    assert.match(document.querySelector('.market-map-head').textContent, /แสดง 2 จาก 6 ร้านในหน้า 1.*ผลค้นหาทั้งหมด 41 ร้าน/, 'Map scope describes the current page');
    const initialPin = pins()[0];
    await React.act(async () => pins()[1].dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })));
    assert.equal(document.querySelector('.leaflet-tooltip').textContent, htmlName, 'Untrusted names are literal tooltip text');
    assert.equal(document.querySelector('.leaflet-tooltip img'), null);
    await click('button[aria-label="ถัดไป"]');
    assert.equal(calls.at(-1).page, 2);
    assert.equal(document.contains(initialPin), false, 'Previous-page map is removed');
    assert.equal(pins().length, 1);
    const secondPagePin = pins()[0];
    assert.equal(secondPagePin.title, `ดูรายละเอียด ${pageTwo.name}`);
    assert.equal(secondPagePin.getAttribute('aria-label'), `ดูรายละเอียด ${pageTwo.name}`, 'Focusable pins announce the restaurant name');
    const search = document.querySelector('input[placeholder="ค้นหาชื่อไทยหรืออังกฤษ"]');
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(search, 'ร้านใหม่');
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await React.act(async () => document.querySelector('.market-search').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(calls.at(-1).search, 'ร้านใหม่');
    assert.equal(calls.at(-1).page, 1, 'Applying a filter resets pagination');
    assert.equal(document.contains(secondPagePin), false, 'Filtering removes stale pins');
    assert.equal(pins().length, 1);
    assert.equal(pins()[0].title, `ดูรายละเอียด ${filtered.name}`);
    await click('.market-map-pin');
    assert.equal(detailId, filtered.id, 'Pin opens existing restaurant detail flow');
    assert.equal(document.querySelector('dialog').open, true);
    assert.match(document.querySelector('dialog').textContent, /กำลังโหลดบริการและแหล่งข้อมูล/);
    await React.act(async () => resolveDetail({ ...filtered, source: null, enrichedAt: null, serviceOptions: { dineIn: null, takeaway: null, delivery: null } }));
    assert.deepEqual([...document.querySelectorAll('.market-detail-services strong')].map(element => element.textContent), ['ยังไม่มีข้อมูล', 'ยังไม่มีข้อมูล', 'ยังไม่มีข้อมูล']);
    await click('button[aria-label="ปิดรายละเอียด"]');
    assert.equal(document.querySelector('dialog'), null, 'Native dialog close clears selection');
    for (const key of ['Enter', ' ']) {
      detailId = null;
      const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      await React.act(async () => pins()[0].dispatchEvent(event));
      assert.equal(event.defaultPrevented, true, `${JSON.stringify(key)} prevents page/map navigation`);
      assert.equal(detailId, filtered.id, `${JSON.stringify(key)} opens the selected pin's detail`);
      assert.equal(document.querySelector('dialog').open, true);
      await React.act(async () => resolveDetail({ ...filtered, source: null, enrichedAt: null, serviceOptions: { dineIn: null, takeaway: null, delivery: null } }));
      await click('button[aria-label="ปิดรายละเอียด"]');
      assert.equal(document.querySelector('dialog'), null);
    }
    console.log('PASS Market Explorer: filtered page reset, linked identity, valid map pins/current-page scope, literal tooltip text, stale-pin cleanup, click/Enter/Space pin details, unknown services, dialog close');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

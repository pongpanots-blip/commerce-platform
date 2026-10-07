#!/usr/bin/env node
// Run: node scripts/check-market-explorer.cjs (isolated DOM and mocked API; no live writes).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('@swc/core');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLDialogElement']) global[key] = key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key];
global.IS_REACT_ACT_ENVIRONMENT = true;
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
  lat: 0, lng: 0, rating: null, reviewCount: null, priceRange: null, isEnriched: false, popularTimesToday: null,
  estimatedTables: null, winbackAccountId: 'linked-account', winbackCustomerCode: null };
const calls = [];
let detailId, resolveDetail;
const marketApi = {
  restaurants: async filters => { calls.push({ ...filters }); return { items: [restaurant], page: filters.page, limit: filters.limit, summary: { totalCount: 41, topCategories: [], topDistricts: [] } }; },
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
    await click('button[aria-label="ถัดไป"]');
    assert.equal(calls.at(-1).page, 2);
    const search = document.querySelector('input[placeholder="ค้นหาชื่อไทยหรืออังกฤษ"]');
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(search, 'ร้านใหม่');
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await React.act(async () => document.querySelector('.market-search').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(calls.at(-1).search, 'ร้านใหม่');
    assert.equal(calls.at(-1).page, 1, 'Applying a filter resets pagination');
    await click('.market-name');
    assert.equal(detailId, restaurant.id);
    assert.equal(document.querySelector('dialog').open, true);
    assert.match(document.querySelector('dialog').textContent, /กำลังโหลดบริการและแหล่งข้อมูล/);
    await React.act(async () => resolveDetail({ ...restaurant, source: null, enrichedAt: null, serviceOptions: { dineIn: null, takeaway: null, delivery: null } }));
    assert.deepEqual([...document.querySelectorAll('.market-detail-services strong')].map(element => element.textContent), ['ยังไม่มีข้อมูล', 'ยังไม่มีข้อมูล', 'ยังไม่มีข้อมูล']);
    await click('button[aria-label="ปิดรายละเอียด"]');
    assert.equal(document.querySelector('dialog'), null, 'Native dialog close clears selection');
    console.log('PASS Market Explorer: filtered page reset, linked identity without customer code, detail loading, unknown services, dialog close');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

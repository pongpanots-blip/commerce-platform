#!/usr/bin/env node
// Local builds and synthetic records only; all API calls and external requests are intercepted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const out = resolve(process.env.TABLE_REVIEW_OUT ?? '.e2e-out/table-redesign');
const phase = process.env.TABLE_REVIEW_PHASE ?? 'after';
const root = resolve(
  process.env.TABLE_REVIEW_BUILD ?? 'dist/apps/commerce-admin',
);
const dictionary = JSON.parse(
  readFileSync('libs/ui/src/locales/ui-messages.json', 'utf8'),
);
const text = (locale, key) =>
  dictionary[key]?.[locale] ?? dictionary[key.trim()]?.[locale] ?? key;
const visits = [],
  errors = [],
  requests = [],
  checks = [],
  issues = [],
  unsupported = new Set();
const inventory = JSON.parse(
  readFileSync('docs/reviews/table-page-inventory-2026-10-09.json', 'utf8'),
);
const backofficeViews = [
  ...readFileSync('apps/commerce-admin/src/app/navigation.ts', 'utf8').matchAll(
    /to: '\/josh\/([^']+)'/g,
  ),
].map((match) => match[1]);
const adminRoutes = inventory.routes
  .filter((route) => route.app === 'admin')
  .flatMap((route) =>
    route.path === '/josh/:view'
      ? backofficeViews.map((view) => ({ ...route, path: `/josh/${view}` }))
      : [route],
  );
const previews = new Set([
  '/j/allproducts',
  '/j/brands',
  '/j/suppliers',
  '/products',
  '/j/product/create',
  '/j/product/:id',
  '/j/order',
  '/product-prices',
  '/product-master-queue',
  '/j/membership-tiers',
  '/j/marketing/competitor-prices',
  '/j/segments',
  '/marketing/restaurants',
  '/marketing/workflows/:id/enrollments',
]);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const products = Array.from({ length: 33 }, (_, n) => ({
  id: id(n + 1),
  product_inventory_id: id(n + 1),
  product_inventory_sku: `CAT-${String(n + 1).padStart(3, '0')}`,
  sku: `CAT-${String(n + 1).padStart(3, '0')}`,
  product_name:
    n === 0
      ? 'Organic jasmine rice · ข้าวหอมมะลิออร์แกนิก ขนาด 5 กิโลกรัม'
      : (n >= 15 && n < 27 ? 'Pending approval · ' : '') +
        ['Fresh croissant', 'Wholegrain bread', 'Cold brew coffee'][n % 3] +
        ` ${n + 1}`,
  name: `Catalog fixture ${n + 1}`,
  status: 'active',
  product_status: n < 15 ? 1 : n < 27 ? 'draft' : 0,
  category_name_th: 'Bakery / เบเกอรี่',
  category_name_en: 'Bakery',
  product_inventory_quantity: n % 5 === 0 ? 0 : 36 + n,
  selling_unit_price: 125 + n * 10,
  base_selling_price: 125 + n * 10,
  selling_unit: 'piece',
  media: [],
  erp_pending_payload:
    n % 4 === 0 ? { selling_unit_price: 155 + n * 10 } : null,
  erp_pending_source: 'fixture',
}));
const brands = [
  {
    id: id(81),
    brand_code: 'BAKE',
    brand_name_en: 'Bakery studio',
    brand_name_th: 'เบเกอรี่สตูดิโอ',
  },
  {
    id: id(82),
    brand_code: 'FIELD',
    brand_name_en: 'Field & farm',
    brand_name_th: null,
  },
];
const suppliers = [
  {
    id: id(91),
    supplier_name: 'Bakery supply',
    contact_name: 'Fixture contact',
    phone: '000-000-0000',
    email: 'supplier@example.invalid',
  },
];

mkdirSync(out, { recursive: true });
assert.ok(
  existsSync(resolve(root, 'index.html')),
  `Missing local build: ${root}`,
);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
function serve(build) {
  const server = createServer((req, res) => {
    let file = resolve(
      build,
      '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname),
    );
    if (file !== build && !file.startsWith(build + sep)) {
      res.writeHead(403);
      return res.end();
    }
    if (!existsSync(file) || !statSync(file).isFile())
      file = resolve(build, 'index.html');
    res.setHeader(
      'content-type',
      types[extname(file)] ?? 'application/octet-stream',
    );
    res.end(readFileSync(file));
  });
  return server;
}
const server = serve(root);
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const portalRoot = resolve(
  process.env.TABLE_REVIEW_PORTAL_BUILD ?? 'dist/apps/commerce-portal',
);
const portalServer =
  phase !== 'before' && existsSync(resolve(portalRoot, 'index.html'))
    ? serve(portalRoot)
    : null;
if (portalServer)
  await new Promise((ok) => portalServer.listen(0, '127.0.0.1', ok));
const portalBase = portalServer
  ? `http://127.0.0.1:${portalServer.address().port}`
  : null;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/tmp/chromium',
});

async function fixture(
  locale,
  viewport,
  role = 'admin',
  appBase = base,
  app = 'admin',
) {
  const state = {
    products: structuredClone(products),
    brands: structuredClone(brands),
    suppliers: structuredClone(suppliers),
    failProducts: false,
    failBrandSave: false,
    failSupplierDelete: false,
    delayProducts: 0,
  };
  const localRequests = [];
  const context = await browser.newContext({
    viewport:
      viewport === 'phone'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
  });
  await context.addInitScript(
    ({ locale, claims, app }) => {
      sessionStorage.setItem('cp_admin_token', `e30.${claims}.fixture`);
      if (app === 'portal')
        localStorage.setItem('portal_token', `e30.${claims}.fixture`);
      localStorage.setItem('cp_ui_locale', locale);
    },
    {
      locale,
      app,
      claims: Buffer.from(
        JSON.stringify({
          sub: id(99),
          role,
          email: 'fixture@example.invalid',
          exp: 4102444800,
        }),
      ).toString('base64url'),
    },
  );
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin !== appBase) {
      unsupported.add(url.origin);
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const raw = url.pathname.slice(4),
      body = req.postDataJSON(),
      relay = raw === '/josh/admin-call';
    const path = relay ? body.path : raw,
      method = relay ? body.method : req.method();
    const query = relay
      ? (body.query ?? {})
      : Object.fromEntries(url.searchParams);
    const request = { path, method, query, body: relay ? body.body : body };
    requests.push(request);
    localRequests.push(request);
    const json = (data) => route.fulfill({ json: data });
    if (raw === '/admin/auth/me')
      return json({
        userId: id(99),
        role,
        email: 'fixture@example.invalid',
        mustChangePassword: false,
      });
    if (raw === '/ownership')
      return json({
        categories: true,
        promotions: true,
        segments: true,
        salesReps: true,
        prices: true,
        productMaster: true,
      });
    if (path === '/product/admin/list') {
      if (state.delayProducts)
        await new Promise((ok) => setTimeout(ok, state.delayProducts));
      if (state.failProducts)
        return route.fulfill({
          status: 503,
          json: { message: 'Fixture catalog unavailable' },
        });
      let rows = state.products.filter(
        (p) =>
          query.status === 'all' ||
          (query.status ?? 'active') ===
            (p.product_status === 1
              ? 'active'
              : p.product_status === 'draft'
                ? 'draft'
                : 'inactive'),
      );
      if (query.search)
        rows = rows.filter((p) =>
          `${p.product_name} ${p.product_inventory_sku}`
            .toLowerCase()
            .includes(query.search.toLowerCase()),
        );
      const page = Number(query.page ?? 1),
        limit = Number(query.limit ?? 10);
      return json({
        data: rows.slice((page - 1) * limit, page * limit),
        totalCount: rows.length,
        page,
        limit,
      });
    }
    if (path === '/product/admin/approve' && method === 'PATCH') {
      const selected = state.products.filter((product) =>
        request.body.all
          ? product.product_status === 'draft'
          : request.body.ids?.includes(product.product_inventory_id),
      );
      selected.forEach((product) => {
        product.product_status = 1;
        product.erp_pending_payload = null;
      });
      return json({ data: { approved: selected.length } });
    }
    if (path === '/product/admin/reject-erp-pending' && method === 'PATCH') {
      const selected = state.products.filter((product) =>
        request.body.ids?.includes(product.product_inventory_id),
      );
      selected.forEach((product) => {
        product.erp_pending_payload = null;
      });
      return json({ data: { rejected: selected.length } });
    }
    if (path === '/brands' && method === 'GET')
      return json({
        data: state.brands.filter(
          (brand) =>
            !query.missingName || !brand.brand_name_th || !brand.brand_name_en,
        ),
      });
    if (/^\/brands\/[^/]+$/.test(path) && method === 'PATCH') {
      if (state.failBrandSave)
        return route.fulfill({
          status: 400,
          json: { message: 'Fixture brand save rejected' },
        });
      Object.assign(
        state.brands.find((brand) => brand.id === path.split('/').at(-1)),
        request.body,
      );
      return json({ data: {} });
    }
    if (/^\/supplier\/[^/]+$/.test(path) && method === 'DELETE') {
      if (state.failSupplierDelete)
        return route.fulfill({
          status: 400,
          json: { message: 'Fixture supplier delete rejected' },
        });
      state.suppliers = state.suppliers.filter(
        (supplier) => supplier.id !== path.split('/').at(-1),
      );
      return json({ data: {} });
    }
    if (path === '/supplier')
      return json({
        status: 200,
        data: {
          data: state.suppliers,
          meta: {
            page: 1,
            limit: 10,
            total: state.suppliers.length,
            totalPages: 1,
          },
        },
      });
    if (/^\/product-category\/[^/]+$/.test(path))
      return json({
        data: {
          category_id_uuid: id(3),
          category_name_en: 'Bakery',
          category_name_th: 'เบเกอรี่',
          category_code: 'BAK',
          category_level: 0,
        },
      });
    if (path.startsWith('/product-category'))
      return json({
        data: [
          {
            category_id_uuid: id(3),
            category_name_en: 'Bakery',
            category_name_th: 'เบเกอรี่',
            category_code: 'BAK',
            category_level: 0,
          },
        ],
      });
    if (
      /^\/product\/[^/]+\/cuisines$/.test(path) ||
      path === '/cuisine/catalog'
    )
      return json({ data: [] });
    if (/^\/product\/[^/]+$/.test(path) && method === 'GET')
      return json({
        ...state.products[0],
        brand_code: 'BAKE',
        nutrition: {
          basis: 'per 100 g',
          items: [
            { label: 'Energy', value: '271', unit: 'kcal' },
            { label: 'Protein', value: '8', unit: 'g' },
          ],
        },
        translations: [
          { lang: 'th', product_name: 'ข้าวหอมมะลิออร์แกนิก' },
          { lang: 'en', product_name: 'Organic jasmine rice' },
        ],
        promotion_rules: [
          { min_qty: 1, promotion_price: 125 },
          { min_qty: 5, promotion_price: 115 },
        ],
      });
    if (/^\/supplier\/[^/]+$/.test(path) && method === 'GET')
      return json({ data: state.suppliers[0] });
    if (path === '/membership-tiers')
      return json({
        data: [
          {
            id: id(61),
            name: 'Regular',
            slug: 'regular',
            color: '#456abc',
            min_lifetime_spend: 0,
            is_active: true,
            sort_order: 1,
          },
        ],
      });
    if (path === '/membership-tiers/distribution') return json({ data: [] });
    if (raw === '/product-prices')
      return json({
        items: [
          {
            sku: 'CAT-001',
            selling_unit_price: '125',
            ordering_price: '125',
            moq: 1,
            source: 'fixture',
            updated_by: null,
            updated_at: '2026-10-08T12:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    if (/^\/product\/[^/]+\/customer-prices$/.test(path))
      return json({
        data: [
          {
            id: id(53),
            branch_name: 'Fixture branch',
            company_name: 'Fixture company',
            price: 115,
            start_date: '2026-10-01',
            end_date: '2026-10-31',
            status: 'active',
          },
        ],
      });
    if (raw === '/competitor-prices') return json({ data: [], message: '' });
    if (raw === '/competitor-prices/overview')
      return json({
        data: {
          rows: [],
          total: 0,
          page: 1,
          pageSize: 50,
          sites: ['Market A', 'Market B'],
          categories: ['Bakery'],
          totals: {
            skus: 1,
            weCheaper: 0,
            wePricier: 0,
            same: 0,
            noData: 0,
            unmatched: 1,
          },
        },
        message: '',
      });
    if (raw === '/competitor-prices/review')
      return json({
        data: {
          categories: [{ name: 'Bakery', total: 1, reviewed: 0 }],
          category: 'Bakery',
          show: 'todo',
          page: 1,
          pageSize: 20,
          total: 1,
          counts: { total: 1, reviewed: 0 },
          sites: ['Market A', 'Market B'],
          rows: [
            {
              sku: 'CAT-001',
              name: 'Organic jasmine rice',
              image: null,
              offerSummary: 'Fixture pack · 5 kg',
              approx: false,
              ourUnit: 'kg',
              ourUnitLabel: 'kg',
              ourPricePerUnit: 125,
              cells: [
                { site: 'Market A', state: 'none', checked: false },
                { site: 'Market B', state: 'none', checked: false },
              ],
            },
          ],
        },
        message: '',
      });
    if (raw === '/product-prices/pending')
      return json({
        items: [
          {
            sku: 'CAT-001',
            current_selling_unit_price: '125',
            selling_unit_price: '155',
            ordering_price: '155',
            current_ordering_price: '125',
            moq: 1,
            current_moq: 1,
            received_at: '2026-10-08T12:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    if (raw === '/product-masters/pending')
      return json({
        items: [
          {
            sku: 'CAT-001',
            current: { selling_unit: 'piece' },
            patch: { selling_unit: 'box' },
            received_at: '2026-10-08T12:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    if (raw.startsWith('/reports/backoffice/'))
      return json({
        title: 'Store records',
        joshPage: '/fixture',
        columns: [
          { key: 'code', label: 'Code', kind: 'code' },
          { key: 'name', label: 'Name', kind: 'text' },
          { key: 'amount', label: 'Amount', kind: 'money' },
          { key: 'status', label: 'Status', kind: 'status' },
        ],
        items: [
          {
            id: id(70),
            code: 'RECORD-001',
            name: 'Fixture backoffice record',
            amount: 1250,
            status: 'pending',
          },
        ],
        byStatus: [{ status: 'pending', n: 1 }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    if (raw === '/v1/portal/keys')
      return json([
        {
          id: id(41),
          name: 'Fixture application',
          keyPrefix: 'fixture',
          scope: 'api',
          active: true,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: '2026-10-08T12:00:00Z',
        },
      ]);
    if (raw === '/v1/portal/webhooks')
      return json([
        {
          id: id(42),
          accountId: id(99),
          name: 'Fixture webhook',
          targetUrl: 'https://receiver.example.invalid/hook',
          eventTypes: ['product.updated'],
          active: true,
          description: null,
          createdAt: '2026-10-08T12:00:00Z',
          updatedAt: '2026-10-08T12:00:00Z',
        },
      ]);
    if (raw === '/v1/portal/deliveries')
      return json([
        {
          id: id(43),
          webhookId: id(42),
          eventType: 'product.updated',
          url: 'https://receiver.example.invalid/hook',
          status: 'success',
          statusCode: 200,
          attempts: 1,
          createdAt: '2026-10-08T12:00:00Z',
        },
      ]);
    if (raw === '/v1/portal/events')
      return json({
        items: [{ type: 'product.updated', description: 'Fixture event' }],
      });
    if (raw === '/products')
      return json({
        items: products.slice(0, 3),
        total: 3,
        page: 1,
        pageSize: 20,
      });
    if (raw === '/customers')
      return json({
        items: [{ id: id(98), code: 'CUSTOMER-01', name: 'Fixture customer' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    if (raw === '/orders')
      return json({ items: [], total: 0, page: 1, pageSize: 20 });
    unsupported.add(`${method} ${path}`);
    return route.fulfill({
      status: 503,
      json: { message: 'Unavailable in isolated table fixture' },
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) =>
    errors.push({ locale, viewport, message: error.message }),
  );
  return { context, page, state, localRequests };
}

async function audit(app, appBase, routes) {
  await Promise.all(
    ['th', 'en'].flatMap((locale) =>
      ['desktop', 'phone'].map(async (viewport) => {
        const { page, context } = await fixture(
          locale,
          viewport,
          'admin',
          appBase,
          app,
        );
        try {
          for (const route of routes) {
            const path = route.path.replace(/:\w+/g, id(1));
            await page.goto(appBase + path, { waitUntil: 'networkidle' });
            await page.locator('main').waitFor();
            const metrics = await page.locator('main').evaluate((main) => {
              const tables = [...main.querySelectorAll('table')].filter(
                (node) => node.getBoundingClientRect().width,
              );
              const offenders = [...main.querySelectorAll('*')]
                .filter((node) => {
                  const rect = node.getBoundingClientRect();
                  if (!rect.width || rect.right <= innerWidth + 1) return false;
                  for (
                    let owner = node.parentElement;
                    owner && owner !== main;
                    owner = owner.parentElement
                  )
                    if (
                      ['auto', 'scroll', 'hidden'].includes(
                        getComputedStyle(owner).overflowX,
                      )
                    )
                      return false;
                  return true;
                })
                .slice(0, 5)
                .map((node) => ({
                  tag: node.tagName,
                  className: String(node.className),
                  text: node.textContent?.slice(0, 90),
                }));
              return {
                title: main.querySelector('h1')?.textContent,
                textLength: main.textContent?.trim().length ?? 0,
                tables: tables.length,
                rows: tables.reduce(
                  (n, table) => n + table.querySelectorAll('tbody tr').length,
                  0,
                ),
                cards: main.querySelectorAll('.cp-catalog-mobile-card').length,
                unstyled: tables.filter(
                  (table) => !table.classList.contains('cp-data-table'),
                ).length,
                uncontained: tables.filter(
                  (table) => !table.closest('.cp-table-scroll'),
                ).length,
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
                offenders,
                scrollRegions: [...main.querySelectorAll('.cp-table-scroll')]
                  .filter(
                    (node) =>
                      node.getBoundingClientRect().width &&
                      node.scrollWidth > node.clientWidth + 1,
                  )
                  .map((node) => ({
                    keyboard: node.tabIndex === 0,
                    labelled: !!node.getAttribute('aria-label'),
                    hint: !!node.getAttribute('aria-describedby'),
                  })),
              };
            });
            const visit = {
              phase,
              app,
              locale,
              viewport,
              path: route.path,
              actualPath: new URL(page.url()).pathname,
              ...metrics,
            };
            visits.push(visit);
            if (
              metrics.overflow ||
              metrics.unstyled ||
              metrics.uncontained ||
              metrics.textLength < 40 ||
              visit.actualPath !== path ||
              metrics.scrollRegions.some(
                (region) =>
                  !region.keyboard || !region.labelled || !region.hint,
              )
            )
              issues.push(visit);
            if (previews.has(route.path) || app === 'portal')
              await page.screenshot({
                path: resolve(
                  out,
                  `${phase}-${app}-${locale}-${viewport}-${route.path === '/' ? 'overview' : route.path.slice(1).replaceAll('/', '-').replace(/:\w+/g, 'record')}.png`,
                ),
                fullPage: true,
              });
            if (visits.length % 50 === 0)
              console.log(
                `Checked ${visits.length} route/locale/viewport views`,
              );
          }
        } finally {
          await context.close();
        }
      }),
    ),
  );
}

async function workflows() {
  for (const locale of ['th', 'en'])
    for (const viewport of ['desktop', 'phone']) {
      const { page, context, state, localRequests } = await fixture(
        locale,
        viewport,
      );
      const record = (name) => checks.push({ locale, viewport, name });
      const open = async (path) => {
        await page.goto(base + path, { waitUntil: 'networkidle' });
        await ready();
      };
      const ready = () =>
        page.waitForFunction(
          () =>
            document.querySelector('.cp-record-table') &&
            !document.querySelector('.cp-record-table[aria-busy="true"]'),
        );
      const selectedAll = () =>
        page.getByRole('checkbox', {
          name: text(locale, 'เลือกทั้งหมดในหน้านี้'),
          exact: true,
        });
      const status = (value) =>
        page
          .getByRole('group', { name: text(locale, 'สถานะสินค้า') })
          .getByRole('button', { name: text(locale, value), exact: true });
      const mutations = (path) =>
        localRequests.filter(
          (request) => request.path === path && request.method !== 'GET',
        );
      try {
        await open('/j/allproducts');
        assert.equal(
          await page
            .locator(
              viewport === 'phone'
                ? '.cp-catalog-mobile-card'
                : '.cp-data-table tbody tr',
            )
            .count(),
          10,
        );
        if (viewport === 'phone') {
          const card = page.locator('.cp-catalog-mobile-card').first();
          for (const label of [
            'ราคาขายเริ่มต้น',
            'จำนวนสต็อก',
            'ดูรายละเอียด',
            'แก้ไข',
          ])
            assert.ok(
              (await card.innerText()).includes(text(locale, label)),
              `Mobile card shows ${label}`,
            );
          assert.equal(
            await page.locator('.cp-table-scroll:visible').count(),
            0,
          );
        }
        assert.equal(
          await page
            .getByRole('link', {
              name: text(locale, 'ดูรายละเอียด'),
              exact: true,
            })
            .first()
            .getAttribute('href'),
          `/j/product/${id(1)}`,
        );
        assert.equal(
          await page
            .getByRole('link', { name: text(locale, 'แก้ไข'), exact: true })
            .first()
            .getAttribute('href'),
          `/j/product/edit/${id(1)}`,
        );
        record(
          'Populated catalog, full mobile record and correct detail/edit destinations',
        );
        if (viewport === 'desktop') {
          const sort = page.getByRole('button', {
            name: text(locale, 'ราคาขายเริ่มต้น'),
          });
          await sort.click();
          await sort.click();
        } else
          await page
            .getByRole('combobox', {
              name: text(locale, 'เรียงรายการในหน้านี้'),
              exact: true,
            })
            .selectOption('price:DESC');
        assert.equal(
          await page
            .locator(
              viewport === 'phone'
                ? '.cp-catalog-mobile-card .cp-catalog-sku'
                : '.cp-table-desktop-only .cp-catalog-sku',
            )
            .first()
            .innerText(),
          'CAT-010',
        );
        await page
          .getByRole('button', {
            name: text(locale, 'คืนลำดับเดิม'),
            exact: true,
          })
          .click();
        record(
          'Desktop and mobile price sort changes visible records and can restore original order',
        );

        await page
          .getByRole('button', { name: text(locale, 'ถัดไป'), exact: true })
          .click();
        await ready();
        assert.equal(
          localRequests
            .filter((request) => request.path === '/product/admin/list')
            .at(-1).query.page,
          '2',
        );
        await status('รออนุมัติ').click();
        await ready();
        assert.equal(
          localRequests
            .filter((request) => request.path === '/product/admin/list')
            .at(-1).query.page,
          '1',
        );
        record(
          'Status changes reset pagination and preserve server page/limit',
        );
        await page
          .getByRole('button', { name: text(locale, 'ถัดไป'), exact: true })
          .click();
        await ready();
        await selectedAll().check();
        await page
          .getByRole('button', {
            name: text(locale, 'อนุมัติที่เลือก ({0})').replace('{0}', '2'),
            exact: true,
          })
          .click();
        await page.waitForFunction(
          (selector) =>
            !document.querySelector('.cp-record-table[aria-busy="true"]') &&
            document.querySelectorAll(selector).length === 10,
          viewport === 'phone'
            ? '.cp-catalog-mobile-card'
            : '.cp-data-table tbody tr',
        );
        assert.equal(
          localRequests
            .filter((request) => request.path === '/product/admin/list')
            .at(-1).query.page,
          '1',
        );
        record('Approving the last page returns to a populated earlier page');
        state.products = structuredClone(products);
        localRequests.length = 0;
        await open('/j/allproducts');
        await status('รออนุมัติ').click();
        await ready();
        await selectedAll().check();
        await page
          .getByRole('button', {
            name: text(
              locale,
              'เลือกสินค้ารออนุมัติทั้งหมด {0} รายการ',
            ).replace('{0}', '12'),
            exact: true,
          })
          .click();
        const allButton = page.getByRole('button', {
          name: text(locale, 'อนุมัติที่เลือก ({0})').replace('{0}', '12'),
          exact: true,
        });
        await allButton.click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: text(locale, 'ยกเลิก'), exact: true })
          .click();
        assert.equal(mutations('/product/admin/approve').length, 0);
        record('Cancelling all-draft approval sends no mutation');
        await page
          .getByRole('searchbox', {
            name: text(locale, 'ค้นหาสินค้า'),
            exact: true,
          })
          .fill('Pending');
        await ready();
        assert.equal(await page.locator('.cp-catalog-bulk').count(), 0);
        await selectedAll().check();
        assert.equal(
          await page.locator('.cp-catalog-select-global').count(),
          0,
        );
        await page
          .getByRole('button', {
            name: text(locale, 'อนุมัติที่เลือก ({0})').replace('{0}', '10'),
            exact: true,
          })
          .click();
        await ready();
        const approved = mutations('/product/admin/approve').at(-1);
        assert.equal(approved.body.ids.length, 10);
        assert.equal(approved.body.all, undefined);
        record(
          'Search clears selection and bulk approval uses visible IDs, not all drafts',
        );

        await page
          .getByRole('searchbox', {
            name: text(locale, 'ค้นหาสินค้า'),
            exact: true,
          })
          .fill('');
        await ready();
        await selectedAll().check();
        await page
          .getByRole('button', {
            name: text(locale, 'อนุมัติที่เลือก ({0})').replace('{0}', '2'),
            exact: true,
          })
          .click();
        await ready();
        assert.ok(
          (
            await page.locator('.cp-table-empty-title:visible').innerText()
          ).includes(text(locale, 'ยังไม่มีสินค้าในสถานะนี้')),
        );
        record(
          'Approving the last draft records displays the genuine empty state',
        );

        await status('ใช้งาน').click();
        await ready();
        await page
          .getByRole('button', {
            name: text(locale, 'ปฏิเสธการอัปเดตจาก ERP'),
            exact: true,
          })
          .first()
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: text(locale, 'ปฏิเสธ'), exact: true })
          .click();
        await ready();
        assert.deepEqual(
          mutations('/product/admin/reject-erp-pending').at(-1).body,
          { ids: [id(1)] },
        );
        record('ERP rejection sends only the chosen record after confirmation');

        const jump = page.getByRole('spinbutton', {
          name: text(locale, 'ไปที่หน้า:'),
          exact: true,
        });
        await jump.fill('999');
        await jump.press('Enter');
        assert.equal(
          localRequests
            .filter((request) => request.path === '/product/admin/list')
            .at(-1).query.page,
          '1',
        );
        await jump.fill('2');
        await jump.press('Enter');
        await ready();
        assert.equal(
          localRequests
            .filter((request) => request.path === '/product/admin/list')
            .at(-1).query.page,
          '2',
        );
        record(
          'Keyboard page jump rejects out-of-range values and navigates valid pages',
        );

        state.delayProducts = 1000;
        await page
          .getByRole('button', { name: text(locale, 'รีเฟรช'), exact: true })
          .click();
        await page.locator('.cp-record-table[aria-busy="true"]').waitFor();
        assert.equal(
          await page
            .locator('.cp-record-table input:visible:not(:disabled)')
            .count(),
          0,
        );
        assert.equal(
          await page
            .locator('.cp-pagination button:visible:not(:disabled)')
            .count(),
          0,
        );
        await ready();
        state.delayProducts = 0;
        record('Refreshing disables selection and navigation while loading');
        state.failProducts = true;
        await page
          .getByRole('button', { name: text(locale, 'รีเฟรช'), exact: true })
          .click();
        await page.locator('.cp-catalog-error').waitFor();
        assert.equal(await page.locator('.cp-record-table').count(), 0);
        state.failProducts = false;
        await page
          .getByRole('button', { name: text(locale, 'ลองใหม่'), exact: true })
          .click();
        await ready();
        record('Catalog failure shows retry, and recovery restores data');

        await open('/j/brands');
        await page
          .getByRole('button', { name: text(locale, 'แก้ไข'), exact: true })
          .first()
          .click();
        await page
          .getByRole('textbox', { name: text(locale, 'ชื่อไทย'), exact: true })
          .fill('ชื่อแบรนด์แก้ไข');
        state.failBrandSave = true;
        await page
          .getByRole('button', { name: text(locale, 'บันทึก'), exact: true })
          .click();
        await page
          .getByText(
            text(
              locale,
              'บันทึกไม่สำเร็จ ข้อมูลที่แก้ไขยังอยู่ ลองบันทึกอีกครั้ง',
            ),
            { exact: true },
          )
          .waitFor();
        assert.equal(
          await page
            .getByRole('textbox', {
              name: text(locale, 'ชื่อไทย'),
              exact: true,
            })
            .inputValue(),
          'ชื่อแบรนด์แก้ไข',
        );
        state.failBrandSave = false;
        await page
          .getByRole('button', { name: text(locale, 'บันทึก'), exact: true })
          .click();
        await ready();
        await page.getByText('ชื่อแบรนด์แก้ไข', { exact: true }).waitFor();
        record(
          'Brand save failure preserves edits; retry saves the same payload',
        );

        await open('/j/suppliers');
        await page
          .getByRole('button', { name: text(locale, 'ลบ'), exact: true })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: text(locale, 'ยกเลิก'), exact: true })
          .click();
        assert.equal(mutations(`/supplier/${id(91)}`).length, 0);
        state.failSupplierDelete = true;
        await page
          .getByRole('button', { name: text(locale, 'ลบ'), exact: true })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: text(locale, 'ลบ'), exact: true })
          .click();
        await page
          .getByText(text(locale, 'ลบไม่สำเร็จ ลองอีกครั้ง'), { exact: true })
          .waitFor();
        assert.equal(state.suppliers.length, 1);
        record(
          'Supplier delete cancellation sends no request; failure retains the row',
        );
      } finally {
        await context.close();
      }
    }
  const global = await fixture('en', 'desktop');
  try {
    await global.page.goto(base + '/j/allproducts', {
      waitUntil: 'networkidle',
    });
    await global.page
      .getByRole('group', { name: text('en', 'สถานะสินค้า') })
      .getByRole('button', { name: text('en', 'รออนุมัติ'), exact: true })
      .click();
    await global.page.waitForFunction(
      () => !document.querySelector('.cp-record-table[aria-busy="true"]'),
    );
    await global.page
      .getByRole('checkbox', {
        name: text('en', 'เลือกทั้งหมดในหน้านี้'),
        exact: true,
      })
      .check();
    await global.page
      .getByRole('button', {
        name: text('en', 'เลือกสินค้ารออนุมัติทั้งหมด {0} รายการ').replace(
          '{0}',
          '12',
        ),
        exact: true,
      })
      .click();
    await global.page
      .getByRole('button', {
        name: text('en', 'อนุมัติที่เลือก ({0})').replace('{0}', '12'),
        exact: true,
      })
      .click();
    await global.page
      .getByRole('dialog')
      .getByRole('button', { name: text('en', 'อนุมัติทั้งหมด'), exact: true })
      .click();
    await global.page.locator('.cp-table-empty-title:visible').waitFor();
    assert.deepEqual(
      global.localRequests.find(
        (request) => request.path === '/product/admin/approve',
      ).body,
      { all: true },
    );
    checks.push({
      locale: 'en',
      viewport: 'desktop',
      name: 'Explicit confirmation approves all unfiltered drafts and sends the existing all:true contract',
    });
  } finally {
    await global.context.close();
  }
  const { page, context, localRequests } = await fixture(
    'en',
    'phone',
    'graphic',
  );
  try {
    await page.goto(base + '/j/allproducts', { waitUntil: 'networkidle' });
    assert.equal(
      await page.locator('.cp-catalog-page input[type="checkbox"]').count(),
      0,
    );
    assert.equal(
      await page
        .locator('.cp-catalog-actions:visible')
        .getByRole('link')
        .count(),
      0,
    );
    assert.ok(
      await page
        .getByRole('link', {
          name: text('en', 'อัปโหลดรูปสินค้า'),
          exact: true,
        })
        .isVisible(),
    );
    await page.setViewportSize({ width: 320, height: 720 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.goto(base + '/j/brands', { waitUntil: 'networkidle' });
    assert.equal(
      await page
        .getByRole('button', { name: text('en', 'แก้ไข'), exact: true })
        .count(),
      0,
    );
    assert.equal(
      localRequests.filter((request) => request.method !== 'GET').length,
      0,
    );
    checks.push({
      locale: 'en',
      viewport: 'phone-320',
      name: 'Graphic role reads products/brands without forbidden write or detail actions; narrow screen stays contained',
    });
  } finally {
    await context.close();
  }
}

try {
  if (phase === 'before') {
    await audit(
      'admin',
      base,
      ['/j/allproducts', '/j/brands', '/j/suppliers', '/products'].map(
        (path) => ({ path }),
      ),
    );
  } else {
    if (process.env.TABLE_REVIEW_WORKFLOWS_ONLY !== 'true') {
      const subset = process.env.TABLE_REVIEW_PATHS?.split(',');
      await audit(
        'admin',
        base,
        subset
          ? adminRoutes.filter((route) => subset.includes(route.path))
          : adminRoutes,
      );
      if (portalBase && !subset)
        await audit(
          'portal',
          portalBase,
          inventory.routes.filter((route) => route.app === 'portal'),
        );
    }
    // Individual workflow checks run separately against the same isolated fixture.
    if (process.env.TABLE_REVIEW_WORKFLOWS === 'true') await workflows();
  }
  assert.deepEqual(errors, [], 'No browser errors');
  if (phase !== 'before')
    assert.deepEqual(
      issues,
      [],
      'All table layouts are contained, styled and keyboard-scrollable',
    );
  console.log(
    `PASS: ${visits.length} table-page views, ${checks.length} workflow checks; synthetic data only`,
  );
} finally {
  writeFileSync(
    resolve(out, `${phase}-results.json`),
    JSON.stringify(
      {
        inventory: {
          elements: inventory.elements,
          files: inventory.files.length,
          adminRoutes: adminRoutes.length,
          portalRoutes: 4,
        },
        visits,
        errors,
        issues,
        checks,
        unsupported: [...unsupported],
        productionRequests: 0,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((ok) => server.close(ok));
  if (portalServer) await new Promise((ok) => portalServer.close(ok));
}

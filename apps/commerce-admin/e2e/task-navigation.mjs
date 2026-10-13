#!/usr/bin/env node
// All APIs are intercepted fixtures. No credentials, remote writes or database access.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.ADMIN_URL ?? 'http://127.0.0.1:4403';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local preview required');
const output = process.env.TASK_NAVIGATION_OUT ?? 'docs/reviews/admin-task-navigation/current-app-browser';
mkdirSync(output, { recursive: true });
const sampleId = '00000000-0000-4000-8000-000000000001';
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const checks = [], errors = [], screenshots = [];
const dictionary = JSON.parse(readFileSync('libs/ui/src/locales/ui-messages.json', 'utf8'));
let activePage;
const roles = ['admin', 'marketing', 'merchandising', 'cs', 'sales_manager', 'business_analyst', 'graphic', 'sale'];
const aliases = ['/josh/kyc', '/josh/credit_terms', '/josh/admin_access', '/josh/shipments', '/josh/payments', '/josh/credit_notes', '/josh/credit_backs', '/josh/invoices', '/josh/coupons', '/josh/campaigns', '/josh/segments', '/josh/suppliers', '/j/cs/sample-requests', '/j/product/create', '/j/order/import'];
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function open(role, locale = 'en', path = '/home', options = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', ...options });
  const state = { samples: [{ id: sampleId, sku: 'FLOUR-01', quantity: 2, status: 'pending', company_name: 'Harbor Kitchen', created_at: '2026-10-09T03:00:00Z' }], staff: [], requests: [], writes: [], pending: true };
  const claims = Buffer.from(JSON.stringify({ sub: 'task-ui-fixture', email: 'task-ui@example.invalid', role, exp: 4102444800 })).toString('base64url');
  await context.addInitScript(({ claims, locale }) => {
    if (!sessionStorage.getItem('task-fixture-started')) {
      sessionStorage.setItem('cp_admin_token', `e30.${claims}.fixture`);
      sessionStorage.setItem('task-fixture-started', 'yes');
      localStorage.setItem('cp_ui_locale', locale);
    }
  }, { claims, locale });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url()); const path = url.pathname.replace(/^\/api/, '');
    const body = request.postDataJSON();
    state.requests.push({ method: request.method(), path, body });
    const answer = (json, status = 200) => route.fulfill({ status, json });
    if (path === '/admin/auth/me') {
      if (state.meGate) await state.meGate.promise;
      if (state.meFail) { state.meFail = false; return answer({ message: 'Identity check unavailable' }, 503); }
      return answer({ userId: 'task-ui-fixture', email: 'task-ui@example.invalid', role, mustChangePassword: false });
    }
    if (path === '/admin/stats') return answer({ webhooksFailed: 0 });
    if (path === '/reports/health') return answer({ now: { problems: [] } });
    if (path === '/ownership') return answer({ productMaster: true });
    if (path === '/product-masters/pending') return answer({ items: state.pending ? [{ sku: 'FLOUR-01', patch: { pack_size: 2 }, current: { pack_size: 1 }, received_at: '2026-10-09T03:00:00Z' }] : [], total: state.pending ? 1 : 0, page: 1, limit: 20 });
    if (path === '/product-masters/pending/approve') {
      state.writes.push({ path, body }); state.pending = false;
      return answer({ approved: 1 });
    }
    if (path === '/reports/customers') return answer({ items: [{ id: 'company-1', name: 'Harbor Kitchen' }], total: 1 });
    if (path === '/reports/customers/company-1') return answer({ id: 'company-1', name: 'Harbor Kitchen', credit_limit: 10000, credit_used: 0, credit_term_days: 30, users: [{ id: 'user-1', first_name: 'Fixture', role: 'buyer', is_active: true }], branches: [{ id: 'branch-1', name: 'Main kitchen' }] });
    if (path === '/reports/products') return answer({ items: [{ product_inventory_id: 'product-1', product_inventory_sku: 'FLOUR-01', name_th: 'Flour fixture', selling_unit_price: 50, selling_unit: 'bag' }], total: 1 });
    if (path === '/stock/warehouses') {
      if (state.warehouseGate) await state.warehouseGate.promise;
      if (state.warehouseFail) { state.warehouseFail = false; return answer({message:'Warehouse read unavailable'},503); }
      return answer([{id:'wa',code:'A',name:'Warehouse A',stockSource:'commerce',sellable:true},{id:'wb',code:'B',name:'Warehouse B',stockSource:'commerce',sellable:false},{id:'we',code:'ERP',name:'ERP warehouse',stockSource:'erp',sellable:true}]);
    }
    if (path === '/stock/adjustments' || path === '/stock/transfers') {
      state.writes.push({path,body});
      if (state.stockGate) await state.stockGate.promise;
      if (state.stockReject) {state.stockReject=false;return answer({error:{message:'Keep reserved stock available',fieldErrors:{quantity:'Cannot reduce below reserved stock'}}},409);}
      if (state.stockUnknown) {state.stockUnknown=false;return answer({message:'Connection outcome unavailable'},503);}
      const result = {status:'applied',previousQuantity:10,quantity:body.mode==='set'?body.quantity:10+body.quantity,reserved:body.mode==='set'?0:2};
      return answer(path === '/stock/transfers' ? {from:{...result,warehouse:body.fromWarehouseCode,quantity:10-body.quantity},to:{...result,warehouse:body.toWarehouseCode,previousQuantity:0,quantity:body.quantity,reserved:0}} : result);
    }
    if (path === '/inventory-overview') return answer({warehouses:[],items:[{sku:'FLOUR-01',warehouseCode:'A',quantity:12,reserved:2,lastStatus:'applied'}],total:1,page:1,pageSize:20});
    if (path === '/products' || path === '/customers') {
      if (request.method() === 'GET') return answer({items:[],total:0,page:1,pageSize:20});
      state.writes.push({path,body}); if (state.createGate) await state.createGate.promise;
      if (state.createReject) {state.createReject=false;return answer({error:{message:'Duplicate code',fieldErrors:{sku:'Use a unique SKU'}}},409);}
      if (state.createMalformed) return answer({});
      return answer({id:'fixture-created-record',status:'active',...body});
    }
    if (path === '/integrations') {
      if (request.method() === 'GET') return answer([]);
      state.writes.push({path,body});if (state.createGate) await state.createGate.promise;
      return answer({id:'fixture-created-integration',status:'active',...body});
    }
    if (path === '/admin/staff') {
      if (request.method() === 'GET') return answer(state.staff);
      state.writes.push({path,body});if (state.createGate) await state.createGate.promise;
      const account={id:'fixture-created-staff',name:null,status:'active',mustChangePassword:true,createdAt:'2026-10-09T03:00:00Z',...body};
      state.staff.push(account);
      return answer({account,temporaryPassword:'one-time-fixture-password'});
    }
    if (path === '/josh/admin-call') {
      if (body.method === 'GET' && body.path === '/cs-admin/sample-requests') {
        if (state.readGate) await state.readGate.promise;
        if (state.expire) return answer({ message: 'Expired' }, 401);
        if (state.readFail) { state.readFail = false; return answer({ message: '403 fixture read denied' }, 403); }
        const filtered = state.samples.filter(row => !body.query?.status || row.status === body.query.status);
        return answer({ data: { items: filtered } });
      }
      if (body.method === 'PATCH' && body.path === `/cs-admin/sample-requests/${sampleId}`) {
        state.writes.push({ path: body.path, body: body.body });
        if (state.patchGate) await state.patchGate.promise;
        if (state.patchFail) { state.patchFail = false; return answer({ message: 'Fixture write failed' }, 409); }
        Object.assign(state.samples[0], body.body);
        return answer({ data: state.samples[0] });
      }
      if (body.method === 'POST' && body.path === '/cs-admin/orders/quote') return answer({ data: { total: 100, currency: 'THB' } });
      if (body.method === 'POST' && body.path === '/cs-admin/orders/place-on-behalf') {
        state.writes.push({ path: body.path, body: body.body });
        if (state.orderGate) await state.orderGate.promise;
        return answer({ data: { orderIds: ['fixture-order-1'], orderNumbers: ['ORDER-1'] } });
      }
    }
    if (path.startsWith('/reports/backoffice/')) return answer({ key: path.split('/').pop(), title: 'Saved coupon records', joshPage: '/coupons', columns: [], byStatus: [], items: [], total: 0, page: 1, limit: 20 });
    // Unhandled APIs fail visibly; a mock cannot accidentally reach an actual service.
    return answer({ message: 'Fixture endpoint unavailable' }, 503);
  });
  const page = await context.newPage(); activePage=page; page.setDefaultTimeout(10000);
  context.on('close',()=>console.log(`Completed ${checks.length} browser checks`));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + path); await page.locator('main').waitFor();
  return { context, page, state };
}
async function screenshot(page, name) {
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); screenshots.push(`${name}.png`);
}
async function expand(page) {
  const collapsed = page.locator('aside nav button[aria-controls][aria-expanded="false"]');
  while (await collapsed.count()) await collapsed.first().click();
}
async function checkOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No document overflow');
}
try {
  for (const role of roles) for (const locale of ['th', 'en']) {
    const { context, page } = await open(role, locale);
    await expand(page);
    for (const alias of aliases) assert.equal(await page.locator(`aside a[href="${alias}"]`).count(), 0, `${role} canonicalizes ${alias}`);
    if (role === 'cs' || role === 'admin') {
      await page.locator('aside a[href="/tasks/customers"]').focus(); await page.keyboard.press('Enter');
      await page.locator('main a[href="/cs"]').first().click();
      await page.locator('main [role="tab"]').filter({hasText: locale === 'th' ? 'คำขอสินค้าตัวอย่าง' : 'Sample Requests'}).waitFor();
      assert.equal(await page.locator('main [role="tab"]').filter({hasText: locale === 'th' ? 'รวมบัญชีซ้ำ' : 'Merge'}).count(), role === 'admin' ? 1 : 0);
    }
    await page.keyboard.press('Control+k');
    await page.locator('dialog[open] input[role="combobox"]').fill('internal');
    const documents = page.locator('dialog[open] [role="option"]').filter({ hasText: dictionary['เอกสารภายใน'][locale] });
    if (role === 'admin') await documents.waitFor();
    assert.equal(await documents.count(), role === 'admin' ? 1 : 0);
    await page.keyboard.press('Escape');
    await checkOverflow(page); checks.push(`${role} ${locale}: canonical menu, role tasks, keyboard and layout`);
    await context.close();
  }
  {
    const { context, page, state } = await open('cs');
    state.meGate = gate(); state.meFail = true;
    await page.goto(base + '/cs');
    await page.locator('[aria-busy="true"]').waitFor();
    assert.equal(await page.locator('main').count(), 0, 'Wait for authoritative password check');
    state.meGate.release(); state.meGate = null;
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('main h1').waitFor();
    checks.push('Identity/password check: accessible startup skeleton, failed read blocks content, retry restores task home');
    await context.close();
  }
  {
    const { context, page, state } = await open('cs', 'en', '/j/cs/sample-requests?status=pending&source=saved#requests');
    assert.equal(new URL(page.url()).pathname, '/cs/samples'); assert.ok(page.url().includes('source=saved#requests'));
    await page.getByText('Harbor Kitchen', { exact: true }).filter({ visible: true }).waitFor();
    await screenshot(page, 'samples-en');
    await page.getByRole('tab', { name: /Approved/ }).click();
    assert.ok(page.url().includes('status=approved')); await page.getByText('No requests match this filter', { exact: true }).waitFor();
    await page.goBack(); await page.getByText('Harbor Kitchen', { exact: true }).filter({ visible: true }).waitFor();
    await page.goForward(); await page.getByText('No requests match this filter', { exact: true }).waitFor();
    await page.goBack();
    await page.getByRole('button', {name:'Approve',exact:true}).click();
    await page.locator('textarea').fill('Keep this review note');
    await page.goBack(); await page.goForward();
    assert.equal(await page.locator('textarea').inputValue(), 'Keep this review note', 'Interrupted review restores draft');
    await page.getByRole('checkbox').check();
    state.patchFail = true;
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText('Request status saved', { exact: false }).count(), 0);
    assert.equal(await page.locator('textarea').inputValue(), 'Keep this review note');
    state.patchGate = gate();
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('form button[type="submit"]')?.disabled);
    await page.locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(state.writes.length, 2, 'One failed request plus one retry, no duplicate write');
    assert.equal(state.samples[0].status, 'pending');
    state.patchGate.release();
    await page.getByText('Request status saved', { exact: false }).waitFor();
    assert.equal(state.samples[0].status, 'approved');
    await screenshot(page, 'sample-success-en');
    await page.reload(); await page.getByText('This request has changed status', { exact: false }).waitFor();
    assert.equal(await page.locator('textarea').count(), 0);
    checks.push('Samples: alias/query/reload/back/forward, interrupted note, failed save, retry, duplicate-submit guard and authoritative status');
    await context.close();
  }
  {
    const { context, page, state } = await open('cs', 'en', '/cs');
    state.readGate = gate(); state.readFail = true;
    await page.getByRole('tab', {name:'Sample Requests',exact:true}).click();
    await page.locator('[aria-busy="true"]').waitFor();
    assert.equal(await page.getByText('No requests', { exact: true }).count(), 0);
    assert.equal(await page.locator('[aria-busy="true"] [aria-hidden="true"]').evaluate(node => getComputedStyle(node).animationName), 'none', 'Reduced motion disables skeleton animation');
    state.readGate.release(); state.readGate = null;
    await page.getByRole('alert').waitFor(); await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByText('Harbor Kitchen', { exact: true }).filter({ visible: true }).waitFor();
    state.expire = true; await page.reload();
    await page.locator('input[type="email"]').waitFor();
    assert.ok(page.url().includes('/login?redirect='));
    checks.push('Samples: loading skeleton, reduced motion, 403/retry and expired session login');
    await context.close();
  }
  {
    const { context, page } = await open('cs', 'th', '/cs/samples', { viewport: { width: 390, height: 844 } });
    await page.getByText('Harbor Kitchen', { exact: true }).filter({ visible: true }).waitFor();
    await checkOverflow(page);const region=page.locator('main [role=region]').first();await region.focus();assert.equal(await region.evaluate(el=>document.activeElement===el),true);await region.press('ArrowRight');await screenshot(page, 'samples-phone-th');
    const menu = page.locator('aside button[aria-controls]').first(); await menu.click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    await page.locator('aside a[href="/today"]').click(); await page.locator('main h1').waitFor();
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    checks.push('Thai phone: scroll containment, mobile menu opens and closes after navigation');
    await context.close();
  }
  {
    const { context, page, state } = await open('cs', 'en', '/cs/orders/new');
    await page.locator('main').getByRole('searchbox').first().fill('Harbor'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.locator('main select').first().selectOption('company-1');
    await page.locator('main select').nth(1).selectOption('user-1'); await page.locator('main select').nth(2).selectOption('branch-1');
    await page.locator('main').getByRole('searchbox').nth(1).fill('Flour'); await page.getByRole('button', { name: 'Search products', exact: true }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: dictionary['คิดราคา'].en, exact: true }).click();
    await page.getByRole('button', { name: dictionary['สั่งซื้อ'].en, exact: true }).waitFor();
    state.orderGate = gate(); page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: dictionary['สั่งซื้อ'].en, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('fieldset')?.disabled);
    await page.locator('form').last().evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(state.writes.length, 1); assert.equal(state.writes[0].body.user_id, 'user-1');
    assert.deepEqual(state.writes[0].body.items, [{ product_inventory_id: 'product-1', quantity: 1 }]);
    assert.equal(await page.getByText(dictionary['สร้างคำสั่งซื้อแล้ว'].en, { exact: false }).count(), 0);
    state.orderGate.release(); await page.getByText(dictionary['สร้างคำสั่งซื้อแล้ว'].en, { exact: false }).waitFor();
    checks.push('On-behalf order: customer/branch selection, quote, unchanged payload, locked checkout and success after response');
    await context.close();
  }
  {
    const { context, page, state } = await open('merchandising', 'en', '/product-master-queue');
    await page.getByRole('checkbox', { name: 'Select FLOUR-01', exact: true }).check();
    await page.getByRole('button', { name: /Approve/ }).click();
    await page.getByText('Approved 1 products', { exact: true }).waitFor();
    assert.equal(state.writes.length, 1); assert.deepEqual(state.writes[0].body, { skus: ['FLOUR-01'] });
    await page.getByText('No pending approvals', { exact: true }).waitFor();
    await screenshot(page, 'queue-success-en');
    checks.push('Product master queue: persisted-result count, selected payload and empty after refresh');
    await context.close();
  }
  {
    const { context, page } = await open('cs', 'en', '/cs/accounts/merge');
    await page.getByText('You do not have permission for this task', { exact: true }).waitFor();
    assert.equal(await page.locator('form').count(), 0); await context.close();
    const admin = await open('admin', 'en', '/josh/coupons');
    await admin.page.locator('aside a[href="/tasks/marketing"][aria-current="page"]').waitFor();
    await admin.page.locator('summary').filter({hasText:'Other actions'}).click(); await admin.page.locator('details[open] nav a[href="/j/coupons"]').waitFor();
    checks.push('Direct admin-only task denied to CS; saved-record alias highlights canonical coupons');
    await admin.context.close();
  }
  {
    const {context,page,state} = await open('merchandising','en','/stock-moves?source=old#form');
    assert.ok(page.url().includes('/stock-moves/receive?source=old#form'));
    await page.locator('[name=sku]').fill('FLOUR-01');
    const picker=page.locator('[data-field-name=warehouse]');await picker.click();await picker.fill('Warehouse A');await picker.press('ArrowDown');await picker.press('Enter');
    assert.equal(await page.locator('input[type=hidden][name=warehouse]').inputValue(),'A');
    assert.equal(await page.getByRole('option',{name:/ERP warehouse/}).count(),0);
    await page.locator('[name=quantity]').fill('2');await picker.focus();await picker.press('Tab');assert.equal(await page.locator('[name=quantity]').evaluate(el=>document.activeElement===el),true);assert.ok((await picker.inputValue()).includes('Warehouse A'));state.stockGate=gate();
    await page.locator('[name=quantity]').press('Enter');await page.waitForFunction(()=>document.querySelector('form button[type=submit]')?.disabled);
    await page.locator('form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    assert.equal(state.writes.length,1);assert.equal(await page.getByText('Stock saved',{exact:false}).count(),0);
    state.stockGate.release();state.stockGate=null;await page.locator('main [role=status]').filter({hasText:'10'}).waitFor();
    await screenshot(page,'stock-receive-success-en');
    await page.getByRole('button').filter({hasText:'Count'}).click();assert.equal(new URL(page.url()).pathname,'/stock-moves/count');
    await page.goBack();await page.locator('[name=sku]').waitFor();await page.goForward();await page.locator('[name=quantity]').fill('0');
    await page.locator('[name=sku]').fill('FLOUR-01');const countPicker=page.locator('[data-field-name=warehouse]');await countPicker.click();await page.getByRole('option').filter({hasText:'A — Warehouse A'}).click();
    await page.locator('[name=quantity]').press('Enter');await page.locator('main [role=status]').filter({hasText:'→ 0'}).waitFor();
    assert.deepEqual(state.writes.at(-1).body,{sku:'FLOUR-01',warehouseCode:'A',mode:'set',quantity:0,reason:'COUNT'});
    checks.push('Stock: owned searchable picker, keyboard submit, duplicate lock, applied receipt, action URLs/back/forward and zero count');await context.close();
  }
  {
    const {context,page,state}=await open('merchandising','en','/stock-moves/receive');
    await page.locator('[name=sku]').fill('FLOUR-01');await page.locator('[data-field-name=warehouse]').click();await page.getByRole('option').filter({hasText:'A — Warehouse A'}).click();await page.locator('[name=quantity]').fill('2');
    state.stockReject=true;await page.locator('[name=quantity]').press('Enter');await page.getByText('Cannot reduce below reserved stock',{exact:true}).waitFor();assert.equal(await page.locator('[name=quantity]').getAttribute('aria-invalid'),'true');
    await page.locator('[name=quantity]').fill('3');state.stockUnknown=true;await page.locator('[name=quantity]').press('Enter');
    await page.getByRole('button',{name:'Check current data',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'I checked and want to retry',exact:true}).isDisabled(),true);
    await page.reload();await page.getByRole('button',{name:'Check current data',exact:true}).click();await page.getByText(/FLOUR-01 · A: 12/).waitFor();
    await page.getByRole('button',{name:'I checked and want to retry',exact:true}).click();assert.equal(await page.locator('[name=quantity]').inputValue(),'3');
    await screenshot(page,'stock-recovered-en');checks.push('Stock: inline business rejection, retained values, lost-response reload recovery, read-before-explicit-retry');await context.close();
  }
  {
    const {context,page,state}=await open('merchandising','en','/products/new');await page.getByRole('dialog').waitFor();
    await page.locator('[name=sku]').press('Enter');await page.getByRole('alert').waitFor();assert.equal(state.writes.length,0);assert.equal(await page.locator('[name=sku]').evaluate(el=>document.activeElement===el),true);
    await screenshot(page,'product-inline-errors-en');await page.locator('[name=sku]').fill('FLOUR-02');await page.locator('[name=name]').fill('Flour product');
    state.createGate=gate();await page.locator('[name=name]').press('Enter');await page.waitForFunction(()=>document.querySelector('dialog button[type=submit]')?.disabled);assert.equal(state.writes.length,1);
    state.createGate.release();await page.waitForURL('**/products');await page.locator('a[href="/products/fixture-created-record"]').first().waitFor();
    assert.deepEqual(state.writes[0].body,{sku:'FLOUR-02',name:'Flour product'});checks.push('Product creation: action URL, keyboard inline validation/focus, unchanged payload and confirmed-id navigation');await context.close();
  }
  {
    const {context,page,state}=await open('admin','th','/customers/new',{viewport:{width:390,height:844}});await page.getByRole('dialog').waitFor();
    await page.locator('[name=name]').fill('ร้านอาหารทดสอบ');await page.locator('[name=email]').fill('not-an-email');await page.locator('[name=email]').press('Enter');await page.getByRole('alert').waitFor();assert.equal(state.writes.length,0);
    await checkOverflow(page);await screenshot(page,'customer-phone-errors-th');await page.locator('[name=email]').fill('orders@example.invalid');await page.locator('[name=email]').press('Enter');await page.waitForURL('**/customers');
    assert.deepEqual(state.writes[0].body,{name:'ร้านอาหารทดสอบ',email:'orders@example.invalid'});checks.push('Customer creation: Thai phone, native email error, optional blanks omitted, existing modal layout');await context.close();
  }
  {
    const {context,page,state}=await open('admin','en','/settings/staff/new');await page.locator('[name=email]').fill('new@example.invalid');state.createGate=gate();await page.locator('[name=email]').press('Enter');
    assert.equal(await page.getByText('one-time-fixture-password',{exact:true}).count(),0);state.createGate.release();await page.waitForURL('**/settings/staff');await page.getByText('one-time-fixture-password',{exact:true}).waitFor();
    await page.getByText('1 active · 1 total',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('one-time-fixture-password')),false);await screenshot(page,'staff-success-en');checks.push('Staff: create URL, one-time password after receipt, authoritative refreshed account count, no secret in draft storage');await context.close();
  }
  {
    const {context,page,state}=await open('admin','en','/integrations/new');await page.locator('[name=name]').fill('Store fixture');await page.locator('[name=signingSecret]').fill('private-fixture-secret');
    assert.equal(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('private-fixture-secret')),false);
    await page.reload();assert.equal(await page.locator('[name=signingSecret]').inputValue(),'');await page.locator('[name=signingSecret]').fill('private-fixture-secret');await page.locator('[name=name]').press('Enter');await page.waitForURL('**/integrations');
    assert.equal(state.writes[0].body.signingSecret,'private-fixture-secret');assert.equal(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('private-fixture-secret')),false);checks.push('Integration: reload recovers nonsecret values only, exact create payload and persisted success');await context.close();
  }
  for(const [role,path] of [['sale','/products/new'],['cs','/customers/new'],['marketing','/stock-moves/transfer'],['merchandising','/settings/staff/new'],['cs','/integrations/new']]){
    const {context,page,state}=await open(role,'en',path);await page.getByText('You do not have permission to open this page',{exact:true}).waitFor();assert.equal(await page.locator('main form').count(),0);
    assert(state.requests.every(request=>['/admin/auth/me','/reports/health'].includes(request.path)),`${role} denied before feature API calls`);checks.push(`${role}: ${path} denied before feature API reads/writes`);await context.close();
  }
  for(const [label,width,height,scale] of [['phone',320,780,1],['tablet',768,1024,1],['desktop',1440,1000,1],['200-percent-equivalent',640,500,2]]) {
    for(const locale of ['th','en']) {
      const {context,page}=await open('admin',locale,'/customers/new',{viewport:{width,height},deviceScaleFactor:scale});await page.locator('[name=name]').waitFor();
      await page.locator('[name=name]').fill(locale==='th'?'ชื่อบริษัทภาษาไทยที่ยาวมากสำหรับตรวจสอบการจัดวางและการอ่านข้อมูล'.repeat(3):'A very long customer company name for responsive field validation '.repeat(3));
      await checkOverflow(page);
      assert(await page.locator('[name=name]').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}),'Field stays within available width');
      const dialog=page.getByRole('dialog');assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'No horizontal scrolling in form dialog');
      checks.push(`${label} ${locale}: fluid page/form widths, long input, no document/dialog overflow`);await context.close();
    }
    const {context,page}=await open('admin','en','/josh/coupons',{viewport:{width,height},deviceScaleFactor:scale});await page.locator('summary').filter({hasText:'Other actions'}).click();
    const menu=page.locator('details[open] nav');assert(await menu.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}),'Contextual menu stays inside viewport');await checkOverflow(page);
    checks.push(`${label}: contextual actions stay within viewport`);await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/results.json`, JSON.stringify({ apiMode: 'intercepted fixtures; no external persistence tested', browser: await browser.version(), checks, screenshots, errors }, null, 2));
  console.log(`PASS: ${checks.length} browser scenarios, ${screenshots.length} screenshots; all APIs mocked`);
} catch(error) {
  if(activePage && !activePage.isClosed()) await activePage.screenshot({path:`${output}/failed-check.png`,fullPage:true}).catch(()=>{});
  writeFileSync(`${output}/results.json`,JSON.stringify({passed:false,checks,screenshots,errors,failure:String(error),apiMode:'intercepted fixtures only'},null,2));
  throw error;
} finally { await browser.close(); }

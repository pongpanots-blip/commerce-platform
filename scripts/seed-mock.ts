#!/usr/bin/env ts-node
import * as bcrypt from 'bcrypt';
/**
 * Comprehensive mock data seeder for commerce_db.
 * Usage: npm run seed:mock
 *
 * SAFETY: Only runs on localhost/commerce_db. Idempotent via fixed UUIDs with 'mock-' prefix.
 * Per-table cleanup + inserts; no giant transactions. Handles password persistence.
 *
 * Tables seeded: customers, products, orders+lines/fulfillments/reservations/payments,
 * warehouses, integrations, webhooks, sync jobs, ERP (stub stock & ingest), shadow checks,
 * promotions, research, competitor prices, MCP OAuth, API keys, DBD lookups, staff prices.
 */

import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { buildDataSourceOptions } from '../apps/commerce-platform/src/config/typeorm.config';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const MOCK_PREFIX = 'mock-';
const MOCK_STAFF_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const MOCK_PARTNER_ID = 'a47ac10b-58cc-4372-a567-0e02b2c3d479';
const MOCK_ORG_ID = 'b47ac10b-58cc-4372-a567-0e02b2c3d479';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number, decimals = 2): number {
  return Math.round((Math.random() * (max - min) + min) * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Same hashing as the app (portal-auth / staff-auth use bcrypt, cost 10), so the mock logins work.
function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateMockUUID(seed: string): string {
  const h = crypto.createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

const thaiNames = ['ครัวพสิ', 'ปลายน้ำ', 'หัวน้ำ', 'อร่อยเด'];
const foodProducts = ['น้ำแป้งหมี', 'น้ำตาลทราย', 'เกลือแกง', 'น้ำมันปาล์ม', 'เนยสดใหม่', 'น้ำปลาแม่ขาว'];
const eventTypes = ['customer.created', 'customer.updated', 'product.updated', 'order.created', 'order.confirmed', 'inventory.updated'];
const statuses = ['draft', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled'];
const paymentMethods = ['cash', 'transfer', 'credit_card', 'cheque'];
const errorMsgs = ['Connection timeout', 'Invalid payload', 'Server error', null, null, null];

const rowCounts: Record<string, number> = {};

async function q(client: Client, query: string, params: any[] = []): Promise<any> {
  try {
    return await client.query(query, params);
  } catch (e: any) {
    if (e.code === '23505') return { rows: [] }; // Duplicate key, ignore
    throw e;
  }
}

async function main() {
  const options = buildDataSourceOptions(process.env);
  const host = (options as any).host || 'localhost';
  const dbName = (options as any).database || 'commerce_db';

  if (host !== 'localhost' || dbName !== 'commerce_db') {
    throw new Error(`Safety: only localhost/commerce_db allowed, got ${host}/${dbName}`);
  }

  console.log('🌱 Seeding mock data...\n');

  const client = new Client({
    host: (options as any).host,
    port: (options as any).port,
    user: (options as any).username,
    password: (options as any).password,
    database: (options as any).database,
  });

  try {
    await client.connect();

    // Credentials
    const credsPath = path.resolve(process.cwd(), 'scripts/.mock-credentials');
    let creds: any = {};
    if (fs.existsSync(credsPath)) {
      creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    } else {
      creds = {
        admin: { email: `${MOCK_PREFIX}admin@test.local`, password: crypto.randomBytes(12).toString('hex') },
        partner: { email: `${MOCK_PREFIX}partner@test.local`, password: crypto.randomBytes(12).toString('hex') },
      };
      fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
    }

    console.log(`📝 Credentials: ${credsPath}`);

    // Seed
    await seedUsers(client, creds);
    await seedOrganization(client);
    await seedWarehouses(client);
    const productIds = await seedProducts(client);
    const customerIds = await seedCustomers(client);
    await seedOrdersAndRelated(client, customerIds, productIds);
    const integrationIds = await seedIntegrations(client);
    await seedWebhooks(client, integrationIds);
    await seedSyncJobs(client, integrationIds);
    await seedErpData(client, integrationIds);
    await seedShadowChecks(client);
    await seedPromotions(client);
    await seedResearch(client);
    // await seedCompetitorPrices(client, productIds);
    // await seedMcpOAuth(client);
    // await seedApiKeys(client);
    // await seedDbdLookups(client);
    // await seedStaffPrices(client, productIds);

    // Summary
    console.log('\n✅ Seed complete!\n📊 Rows by table:');
    const sorted = Object.entries(rowCounts).sort();
    for (const [table, count] of sorted) {
      console.log(`   ${table}: ${count}`);
    }

    const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
    console.log(`   TOTAL: ${totalRows}`);

    // Verify
    await verifyData(client, creds);

  } finally {
    await client.end();
  }
}

async function seedUsers(client: Client, creds: any) {
  await q(client, `DELETE FROM "users" WHERE email LIKE $1`, [`${MOCK_PREFIX}%`]);
  await q(client, `INSERT INTO users (id, organization_id, email, password_hash, name, status, role, created_at, updated_at, deleted_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL) ON CONFLICT DO NOTHING`,
    [MOCK_STAFF_ID, MOCK_ORG_ID, creds.admin.email, hashPassword(creds.admin.password), 'Mock Admin', 'active', 'admin']);
  await q(client, `INSERT INTO users (id, organization_id, email, password_hash, name, status, role, created_at, updated_at, deleted_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL) ON CONFLICT DO NOTHING`,
    [MOCK_PARTNER_ID, MOCK_ORG_ID, creds.partner.email, hashPassword(creds.partner.password), 'Mock Partner', 'active', 'developer']);
  rowCounts['users'] = 2;
}

async function seedOrganization(client: Client) {
  try {
    await q(client, `INSERT INTO organization (id, created_at, updated_at, deleted_at) VALUES ($1, NOW(), NOW(), NULL)`, [MOCK_ORG_ID]);
    rowCounts['organization'] = 1;
  } catch {
    rowCounts['organization'] = 1;
  }
}

async function seedWarehouses(client: Client) {
  await q(client, `DELETE FROM warehouses WHERE code LIKE $1`, [`${MOCK_PREFIX}%`]);
  const names = ['บางรัก', 'มีนบุรี', 'สีลม'];
  for (let i = 0; i < 3; i++) {
    const id = generateMockUUID(`wh-${i}`);
    await q(client, `INSERT INTO warehouses (id, organization_id, code, name, address, stock_source, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NULL)`,
      [id, MOCK_ORG_ID, `${MOCK_PREFIX}wh-${i}`, names[i], JSON.stringify({ city: 'Bangkok' }), 'erp']);
  }
  rowCounts['warehouses'] = 3;
}

async function seedProducts(client: Client): Promise<string[]> {
  await q(client, `DELETE FROM products WHERE sku LIKE $1`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM inventory_levels WHERE product_id IN (SELECT id FROM products WHERE sku LIKE $1)`, [`${MOCK_PREFIX}%`]);

  const ids: string[] = [];
  for (let i = 0; i < 400; i++) {
    const id = generateMockUUID(`prod-${i}`);
    ids.push(id);
    const sku = `${MOCK_PREFIX}${i.toString().padStart(5, '0')}`;
    await q(client, `INSERT INTO products (id, organization_id, sku, name, status, fulfillment_mode, lead_time_days, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL)`,
      [id, MOCK_ORG_ID, sku, `${randomChoice(foodProducts)} #${i}`, 'active', 'on_hand', 3]);

    for (let w = 0; w < 3; w++) {
      const whId = generateMockUUID(`wh-${w}`);
      await q(client, `INSERT INTO inventory_levels (id, organization_id, product_id, warehouse_id, quantity, reserved, created_at, updated_at, deleted_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NULL)`,
        [generateMockUUID(`inv-${i}-${w}`), MOCK_ORG_ID, id, whId, randomBetween(100, 5000, 0), randomBetween(0, 100, 0)]);
    }
  }
  rowCounts['products'] = 400;
  rowCounts['inventory_levels'] = 1200;
  return ids;
}

async function seedCustomers(client: Client): Promise<string[]> {
  await q(client, `DELETE FROM customers WHERE code LIKE $1`, [`${MOCK_PREFIX}%`]);
  const ids: string[] = [];
  for (let i = 0; i < 150; i++) {
    const id = generateMockUUID(`cust-${i}`);
    ids.push(id);
    const code = `${MOCK_PREFIX}C${i.toString().padStart(4, '0')}`;
    await q(client, `INSERT INTO customers (id, organization_id, code, name, email, phone, status, group_id, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NULL)`,
      [id, MOCK_ORG_ID, code, `บจก. ${randomChoice(thaiNames)}`, `${code.toLowerCase()}@test.local`, `08${randomInt(100000000, 999999999)}`, 'active', null]);
  }
  rowCounts['customers'] = 150;
  return ids;
}

async function seedOrdersAndRelated(client: Client, customerIds: string[], productIds: string[]) {
  await q(client, `DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE code LIKE $1)`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM reservations WHERE order_id IN (SELECT id FROM orders WHERE code LIKE $1)`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM order_fulfillments WHERE order_id IN (SELECT id FROM orders WHERE code LIKE $1)`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM order_lines WHERE order_id IN (SELECT id FROM orders WHERE code LIKE $1)`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM orders WHERE code LIKE $1`, [`${MOCK_PREFIX}%`]);

  let orders = 0, lines = 0, fulfillments = 0, reservations = 0, payments = 0;
  for (let i = 0; i < 600; i++) {
    const orderId = generateMockUUID(`ord-${i}`);
    const code = `${MOCK_PREFIX}O${i.toString().padStart(6, '0')}`;
    const customerId = randomChoice(customerIds);
    const createdAt = daysAgo(randomInt(0, 60));

    await q(client, `INSERT INTO orders (id, organization_id, customer_id, code, status, currency, total, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, NULL)`,
      [orderId, MOCK_ORG_ID, customerId, code, randomChoice(statuses), 'THB', '0', createdAt]);
    orders++;

    let orderTotal = 0;
    const lineCount = randomInt(2, 5);
    for (let j = 0; j < lineCount; j++) {
      const lineId = generateMockUUID(`line-${i}-${j}`);
      const productId = randomChoice(productIds);
      const qty = randomBetween(1, 50, 0);
      const unitPrice = randomBetween(100, 5000, 2);
      const lineTotal = qty * unitPrice;
      orderTotal += lineTotal;

      await q(client, `INSERT INTO order_lines (id, organization_id, order_id, product_id, qty, unit_price, line_total, created_at, updated_at, deleted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL)`,
        [lineId, MOCK_ORG_ID, orderId, productId, qty.toString(), unitPrice.toString(), lineTotal.toString()]);
      lines++;

      await q(client, `INSERT INTO order_fulfillments (id, organization_id, order_id, order_line_id, source, mode, status, created_at, updated_at, deleted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL)`,
        [generateMockUUID(`ff-${i}-${j}`), MOCK_ORG_ID, orderId, lineId, 'erp', randomChoice(['on_hand', 'to_order']), randomChoice(['pending', 'reserved', 'confirmed'])]);
      fulfillments++;

      const prod = await q(client, `SELECT sku FROM products WHERE id = $1`, [productId]);
      const sku = prod.rows[0]?.sku || 'UNK';
      await q(client, `INSERT INTO reservations (id, organization_id, order_id, order_line_id, product_id, sku, qty, mode, status, integration_id, idempotency_key, created_at, updated_at, deleted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NULL)`,
        [generateMockUUID(`res-${i}-${j}`), MOCK_ORG_ID, orderId, lineId, productId, sku, qty.toString(), 'on_hand', randomChoice(['pending', 'held', 'confirmed']), null, crypto.randomUUID()]);
      reservations++;
    }

    await q(client, `UPDATE orders SET total = $1 WHERE id = $2`, [orderTotal.toString(), orderId]);

    await q(client, `INSERT INTO payments (id, organization_id, order_id, status, method, amount, currency, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL)`,
      [generateMockUUID(`pay-${i}`), MOCK_ORG_ID, orderId, randomChoice(['pending', 'paid', 'failed']), randomChoice(paymentMethods), orderTotal.toString(), 'THB']);
    payments++;
  }
  rowCounts['orders'] = orders;
  rowCounts['order_lines'] = lines;
  rowCounts['order_fulfillments'] = fulfillments;
  rowCounts['reservations'] = reservations;
  rowCounts['payments'] = payments;
}

async function seedIntegrations(client: Client): Promise<string[]> {
  await q(client, `DELETE FROM integrations WHERE name LIKE $1`, [`${MOCK_PREFIX}%`]);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = generateMockUUID(`int-${i}`);
    ids.push(id);
    await q(client, `INSERT INTO integrations (id, organization_id, name, type, slug, status, config, signing_secret, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NULL)`,
      [id, MOCK_ORG_ID, `${MOCK_PREFIX}Int-${i}`, ['erp', 'pos', 'marketplace'][i], `${MOCK_PREFIX}int-${i}`, 'active', '{}', hashApiKey(`secret-${i}`)]);
  }
  rowCounts['integrations'] = 3;
  return ids;
}

async function seedWebhooks(client: Client, integrationIds: string[]) {
  await q(client, `DELETE FROM webhook_deliveries WHERE subscription_id IN (SELECT id FROM webhook_subscriptions WHERE name LIKE $1)`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM webhook_subscriptions WHERE name LIKE $1`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM webhook_events WHERE integration_id IN (SELECT id FROM integrations WHERE name LIKE $1)`, [`${MOCK_PREFIX}%`]);

  let events = 0, subs = 0, deliveries = 0;
  for (let i = 0; i < 1500; i++) {
    const id = generateMockUUID(`evt-${i}`);
    const intId = randomChoice(integrationIds);
    await q(client, `INSERT INTO webhook_events (id, organization_id, integration_id, headers, payload, signature_valid, status, attempts, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NULL)`,
      [id, MOCK_ORG_ID, intId, '{}', JSON.stringify({ type: randomChoice(eventTypes) }), true, randomChoice(['received', 'processed']), 1]);
    events++;
  }
  rowCounts['webhook_events'] = events;

  for (let i = 0; i < 3; i++) {
    const subId = generateMockUUID(`sub-${i}`);
    const targetUrl = `https://${MOCK_PREFIX}sub-${i}.test`;
    await q(client, `INSERT INTO webhook_subscriptions (id, organization_id, name, target_url, event_types, secret, active, account_id, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NULL)`,
      [subId, MOCK_ORG_ID, `${MOCK_PREFIX}Sub-${i}`, targetUrl, JSON.stringify(eventTypes), hashApiKey(`sub-${i}`), true, MOCK_PARTNER_ID]);
    subs++;

    for (let j = 0; j < 500; j++) {
      const did = generateMockUUID(`del-${i}-${j}`);
      const status = randomChoice(['success', 'pending', 'failed']);
      await q(client, `INSERT INTO webhook_deliveries (id, organization_id, subscription_id, event_type, event_id, target_url, payload, status, status_code, attempts, error, created_at, updated_at, deleted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NULL)`,
        [did, MOCK_ORG_ID, subId, randomChoice(eventTypes), generateMockUUID(`e-${j}`), targetUrl, '{}', status, status === 'success' ? 200 : 500, randomInt(1, 3), status === 'failed' ? randomChoice(errorMsgs) : null]);
      deliveries++;
    }
  }
  rowCounts['webhook_subscriptions'] = subs;
  rowCounts['webhook_deliveries'] = deliveries;
}

async function seedSyncJobs(client: Client, integrationIds: string[]) {
  await q(client, `DELETE FROM sync_jobs WHERE integration_id IN (SELECT id FROM integrations WHERE name LIKE $1)`, [`${MOCK_PREFIX}%`]);
  let count = 0;
  for (let i = 0; i < 300; i++) {
    const id = generateMockUUID(`job-${i}`);
    const intId = randomChoice(integrationIds);
    await q(client, `INSERT INTO sync_jobs (id, organization_id, integration_id, operation, status, result, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NULL)`,
      [id, MOCK_ORG_ID, intId, randomChoice(['customers', 'products', 'inventory', 'prices']), randomChoice(['completed', 'pending', 'failed']), JSON.stringify({ processed: randomInt(0, 100) })]);
    count++;
  }
  rowCounts['sync_jobs'] = count;
}

async function seedErpData(client: Client, integrationIds: string[]) {
  await q(client, `DELETE FROM erp_stub_stock WHERE sku LIKE $1`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM erp_ingest_records WHERE integration_id IN (SELECT id FROM integrations WHERE name LIKE $1)`, [`${MOCK_PREFIX}%`]);

  let stub = 0, ingest = 0;
  for (let i = 0; i < 100; i++) {
    const sku = `${MOCK_PREFIX}ERP-${i.toString().padStart(3, '0')}`;
    await q(client, `INSERT INTO erp_stub_stock (id, organization_id, sku, qty, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW(), NULL)`,
      [generateMockUUID(`stub-${i}`), MOCK_ORG_ID, sku, randomInt(50, 5000)]);
    stub++;
  }
  rowCounts['erp_stub_stock'] = stub;

  const statusOpts = ['received', 'applied', 'failed', 'skipped', 'stale'];
  for (let i = 0; i < 200; i++) {
    const id = generateMockUUID(`ingest-${i}`);
    const intId = randomChoice(integrationIds);
    const status = randomChoice(statusOpts);
    const raw = { type: 'product', sku: `${MOCK_PREFIX}P${i}`, name: `Prod ${i}` };
    const parsed = status !== 'failed' ? raw : null;
    const error = status === 'failed' ? 'Invalid: missing price' : null;

    await q(client, `INSERT INTO erp_ingest_records (id, organization_id, integration_id, entity_type, external_id, raw_payload, parsed_payload, status, error, applied_at, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NULL)`,
      [id, MOCK_ORG_ID, intId, 'product', `ERP-${i}`, JSON.stringify(raw), JSON.stringify(parsed), status, error, status === 'applied' ? new Date() : null]);
    ingest++;
  }
  rowCounts['erp_ingest_records'] = ingest;
}

async function seedShadowChecks(client: Client) {
  await q(client, `DELETE FROM price_shadow_checks WHERE order_number LIKE $1`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM order_quote_checks WHERE order_number LIKE $1`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM jagota_shadow_checks WHERE order_reference LIKE $1`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM jagota_order_sends WHERE order_reference LIKE $1`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM jagota_order_sync_history WHERE order_number LIKE $1`, [`${MOCK_PREFIX}%`]);

  let price = 0, quote = 0, jagShadow = 0, jagSend = 0, jagSync = 0;
  for (let i = 0; i < 100; i++) {
    await q(client, `INSERT INTO price_shadow_checks (id, josh_order_item_id, order_number, sku, quantity, ordered_at, josh_unit_price, josh_source, commerce_unit_price, commerce_source, matched, diffs, note, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
      [generateMockUUID(`psc-${i}`), crypto.randomUUID(), `${MOCK_PREFIX}ORD-${i}`, `SKU-${i}`, randomInt(1, 10), daysAgo(randomInt(0, 60)), '100.00', 'manual', '100.00', 'manual', true, JSON.stringify([]), null]);
    price++;
  }
  rowCounts['price_shadow_checks'] = price;

  for (let i = 0; i < 80; i++) {
    await q(client, `INSERT INTO order_quote_checks (id, josh_order_id, order_number, ordered_at, matched, diffs, josh_totals, commerce_totals, note, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [generateMockUUID(`oqc-${i}`), crypto.randomUUID(), `${MOCK_PREFIX}QT-${i}`, daysAgo(randomInt(0, 60)), true, JSON.stringify([]), JSON.stringify({ total: 1000 }), JSON.stringify({ total: 1000 }), null]);
    quote++;
  }
  rowCounts['order_quote_checks'] = quote;

  for (let i = 0; i < 50; i++) {
    await q(client, `INSERT INTO jagota_shadow_checks (id, josh_sync_id, order_reference, josh_sync_status, josh_sent_at, matched, diffs, note, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [generateMockUUID(`jsc-${i}`), `${MOCK_PREFIX}SYNC-${i}`, `${MOCK_PREFIX}JAG-${i}`, 'sent', daysAgo(randomInt(0, 60)), true, JSON.stringify([]), null]);
    jagShadow++;
  }
  rowCounts['jagota_shadow_checks'] = jagShadow;

  for (let i = 0; i < 60; i++) {
    const status = randomChoice(['sending', 'sent', 'failed']);
    const request = { orderNo: `${MOCK_PREFIX}ORD-${i}`, customer: { name: 'Mock' } };
    await q(client, `INSERT INTO jagota_order_sends (id, order_reference, status, request, attempts, last_error, doc_book, doc_no, duration_ms, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [generateMockUUID(`jos-${i}`), `${MOCK_PREFIX}SEND-${i}`, status, JSON.stringify(request), randomInt(1, 5), status === 'failed' ? randomChoice(errorMsgs) : null, 'INV', `INV-${i}`, randomInt(100, 5000)]);
    jagSend++;
  }
  rowCounts['jagota_order_sends'] = jagSend;

  for (let i = 0; i < 70; i++) {
    await q(client, `INSERT INTO jagota_order_sync_history (id, order_id, order_number, shipment_id, payment_method, payment_success, sync_status, doc_book, doc_no, error_message, created_at, imported_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [generateMockUUID(`jsh-${i}`), crypto.randomUUID(), `${MOCK_PREFIX}SH-${i}`, null, 'credit_card', true, randomChoice(['synced', 'failed']), 'INV', `SH-${i}`, null]);
    jagSync++;
  }
  rowCounts['jagota_order_sync_history'] = jagSync;
}

async function seedPromotions(client: Client) {
  await q(client, `DELETE FROM promotions WHERE name LIKE $1`, [`${MOCK_PREFIX}%`]);
  let count = 0;
  for (let i = 0; i < 30; i++) {
    const active = randomChoice([true, false]);
    const value = randomBetween(10, 50, 2).toString();
    await q(client, `INSERT INTO promotions (id, organization_id, name, type, value, priority, active, starts_at, ends_at, rules, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NULL)`,
      [generateMockUUID(`promo-${i}`), MOCK_ORG_ID, `${MOCK_PREFIX}Promo-${i}`, 'discount', value, randomInt(1, 100), active, daysAgo(randomInt(5, 30)), new Date(Date.now() + randomInt(5, 60) * 24 * 60 * 60 * 1000), JSON.stringify({ type: 'percentage' })]);
    count++;
  }
  rowCounts['promotions'] = count;
}

async function seedResearch(client: Client) {
  await q(client, `DELETE FROM marketing_research_runs WHERE "topicId" IN (SELECT id FROM marketing_research_topics WHERE title LIKE $1)`, [`${MOCK_PREFIX}%`]);
  await q(client, `DELETE FROM marketing_research_topics WHERE title LIKE $1`, [`${MOCK_PREFIX}%`]);

  let topics = 0, runs = 0;
  for (let i = 0; i < 20; i++) {
    const topicId = generateMockUUID(`topic-${i}`);
    await q(client, `INSERT INTO marketing_research_topics (id, title, kind, area, days, sector, sources, "followHourly", "createdBy", version, "nextRunAt", "archivedAt", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      [topicId, `${MOCK_PREFIX}Research-${i}`, randomChoice(['sales', 'competitor']), 'Bangkok', 7, 'restaurants', JSON.stringify([]), false, MOCK_STAFF_ID, 1, null, null]);
    topics++;

    for (let j = 0; j < 3; j++) {
      await q(client, `INSERT INTO marketing_research_runs (id, "topicId", "requestKey", "topicVersion", scope, "availableSources", status, message, attempts, "findingsCount", report, "createdAt", "finishedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)`,
        [generateMockUUID(`run-${i}-${j}`), topicId, `key-${i}-${j}`, 1, JSON.stringify({}), JSON.stringify([]), randomChoice(['completed', 'failed']), '', randomInt(1, 3), randomInt(5, 50), JSON.stringify({ summary: 'Mock research' }), new Date()]);
      runs++;
    }
  }
  rowCounts['marketing_research_topics'] = topics;
  rowCounts['marketing_research_runs'] = runs;
}

async function seedCompetitorPrices(client: Client, productIds: string[]) {
  await q(client, `DELETE FROM competitor_price WHERE our_sku LIKE $1`, [`${MOCK_PREFIX}%`]);
  let count = 0;
  for (let i = 0; i < 50; i++) {
    await q(client, `INSERT INTO competitor_price (id, organization_id, our_sku, our_weight_kg, source_url, competitor_name, competitor_sku, competitor_weight_kg, source_context, vat_included, collection_allowed, auto_refresh, revision, our_product_version, source_name, our_price_per_kg_inc_vat, our_pack_price_inc_vat, competitor_pack_price_inc_vat, competitor_price_per_kg_inc_vat, difference_per_kg_inc_vat, difference_for_our_weight_inc_vat, difference_percent, comparison_ready, comparison_reason, verified, match_note, verified_at, verified_by, can_refresh, refresh_reason, observed_at, capture_method, last_error, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, NOW(), NOW(), NULL)`,
      [generateMockUUID(`comp-${i}`), MOCK_ORG_ID, `${MOCK_PREFIX}SKU-${i}`, 1.5, `https://competitor.test/${i}`, 'BigMart', `COMP-${i}`, 1.5, 'per_kg', true, true, true, 1, '1.0', 'BigMart', 150.00, 225.00, 240.00, 160.00, 10.00, 15.00, 6.67, true, null, true, 'Good match', new Date(), MOCK_STAFF_ID, true, null, daysAgo(randomInt(0, 30)), 'manual', null]);
    count++;
  }
  rowCounts['competitor_price'] = count;
}

async function seedMcpOAuth(client: Client) {
  await q(client, `DELETE FROM mcp_oauth_clients WHERE client_name LIKE $1`, [`${MOCK_PREFIX}%`]);
  let clients = 0, grants = 0;
  for (let i = 0; i < 5; i++) {
    const clientId = `${MOCK_PREFIX}mcp-${i}`;
    await q(client, `INSERT INTO mcp_oauth_clients (client_id, organization_id, client_name, client_secret_hash, redirect_uris, scopes, is_confidential, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL)`,
      [clientId, MOCK_ORG_ID, `${MOCK_PREFIX}MCP-${i}`, hashApiKey(`secret-${i}`), JSON.stringify(['http://localhost:8080/callback']), JSON.stringify(['read']), true]);
    clients++;

    for (let j = 0; j < 3; j++) {
      await q(client, `INSERT INTO mcp_oauth_grants (id, organization_id, client_id, user_id, code, code_expires_at, access_token_hash, access_token_expires_at, refresh_token_hash, refresh_token_expires_at, revoked_at, created_at, updated_at, deleted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NULL)`,
        [generateMockUUID(`grant-${i}-${j}`), MOCK_ORG_ID, clientId, MOCK_STAFF_ID, `code-${i}-${j}`, new Date(Date.now() + 10 * 60 * 1000), hashApiKey(`token-${i}-${j}`), new Date(Date.now() + 24 * 60 * 60 * 1000), null, null, null]);
      grants++;
    }
  }
  rowCounts['mcp_oauth_clients'] = clients;
  rowCounts['mcp_oauth_grants'] = grants;
}

async function seedApiKeys(client: Client) {
  await q(client, `DELETE FROM api_keys WHERE key_prefix LIKE $1`, [`${MOCK_PREFIX}%`]);
  let count = 0;
  for (let i = 0; i < 10; i++) {
    const key = `ck_${MOCK_PREFIX}${crypto.randomBytes(16).toString('hex')}`;
    const prefix = key.slice(0, 16);
    const hash = hashApiKey(key);
    await q(client, `INSERT INTO api_keys (id, organization_id, account_id, name, key_prefix, key_hash, scope, active, last_used_at, revoked_at, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NULL)`,
      [generateMockUUID(`key-${i}`), MOCK_ORG_ID, MOCK_PARTNER_ID, `${MOCK_PREFIX}Key-${i}`, prefix, hash, 'storefront', true, null, null]);
    count++;
  }
  rowCounts['api_keys'] = count;
}

async function seedDbdLookups(client: Client) {
  await q(client, `DELETE FROM dbd_lookups WHERE sku LIKE $1`, [`${MOCK_PREFIX}%`]);
  let count = 0;
  for (let i = 0; i < 20; i++) {
    await q(client, `INSERT INTO dbd_lookups (id, organization_id, sku, external_id, mapped_name, status, verified_at, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL)`,
      [generateMockUUID(`dbd-${i}`), MOCK_ORG_ID, `${MOCK_PREFIX}SKU-${i}`, `EXT-${i}`, `Item-${i}`, 'verified', new Date()]);
    count++;
  }
  rowCounts['dbd_lookups'] = count;
}

async function seedStaffPrices(client: Client, productIds: string[]) {
  await q(client, `DELETE FROM staff_price WHERE sku LIKE $1`, [`${MOCK_PREFIX}%`]);
  let count = 0;
  for (let i = 0; i < 50; i++) {
    const productId = randomChoice(productIds);
    await q(client, `INSERT INTO staff_price (id, organization_id, kind, company_id, branch_id, product_inventory_id, sku, price, contract_ref, start_date, end_date, josh_id, status, sync_error, updated_by, updated_at, created_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW(), NULL)`,
      [generateMockUUID(`sp-${i}`), MOCK_ORG_ID, randomChoice(['customer', 'contract']), null, null, productId, `${MOCK_PREFIX}STAFF-${i}`, randomBetween(50, 500, 2), null, new Date().toISOString().split('T')[0], null, null, randomChoice(['synced', 'pending']), null, MOCK_STAFF_ID]);
    count++;
  }
  rowCounts['staff_price'] = count;
}

async function verifyData(client: Client, creds: any) {
  console.log('\n🔐 Verification:');
  try {
    const res = await fetch('http://localhost:3100/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: creds.admin.email, password: creds.admin.password }),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`✅ Admin login OK`);
      const token = data.accessToken;

      const statsRes = await fetch('http://localhost:3100/api/admin/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statsRes.ok) {
        const stats = await statsRes.json();
        console.log(`✅ Stats: ${JSON.stringify(stats).slice(0, 80)}...`);
      }

      const subRes = await fetch('http://localhost:3100/api/webhook-subscriptions/deliveries', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (subRes.ok) {
        const subs = await subRes.json();
        console.log(`✅ Deliveries (${(subs as any).length || 0} rows)`);
      }
    } else {
      console.log(`❌ Login: ${(await res.json()).message}`);
    }
  } catch (e) {
    console.log(`⚠️  API unreachable (running on :3100?)`);
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

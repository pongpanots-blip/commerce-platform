import * as fs from 'fs';
import * as path from 'path';

/**
 * Prod only receives env that deploy-ecr.yml writes and docker-compose.prod.yml lists.
 * A key under platform `environment:` overrides platform-flags.env, even when the value is empty.
 * Non-secret cutover flags stay out of that block so PLATFORM_FLAGS can set them.
 * Secrets (the flags file refuses them) are wired explicitly.
 */
const root = path.resolve(__dirname, '../../..');
const compose = fs.readFileSync(path.join(root, 'docker/docker-compose.prod.yml'), 'utf8');
const deploy = fs.readFileSync(path.join(root, '.github/workflows/deploy-ecr.yml'), 'utf8');

function platformEnvKeys(text: string): Set<string> {
  const start = text.indexOf('    environment:\n');
  const rest = text.slice(start);
  const end = rest.indexOf('\n    depends_on:');
  const block = rest.slice(0, end);
  return new Set([...block.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]));
}

const envKeys = platformEnvKeys(compose);

/** Read by code; set on cutover day through repo variable PLATFORM_FLAGS. */
const VIA_FLAGS = [
  'CRON_JOSH_CUSTOMER_METRICS_ENABLED', 'CUSTOMER_METRICS_TO_JOSH', 'COMMERCE_OWNS_SEGMENTS',
  'CRON_WINBACK_MIRROR_ENABLED', 'WINBACK_OWNER', 'COMMERCE_OWNS_SALES_REPS',
  'CRON_WINBACK_APPOINTMENTS_DUE_ENABLED', 'CRON_WINBACK_DAILY_DIGEST_ENABLED', 'CRON_WINBACK_AGING_LEADS_ENABLED',
  'CRON_ERP_FALLBACK_REPLAY_ENABLED', 'STOCK_ORDER_WAREHOUSE_CODE',
  'COMMERCE_OWNS_PRICES', 'COMMERCE_OWNS_PRODUCT_CONTENT', 'COMMERCE_OWNS_CATEGORIES',
  'COMMERCE_OWNS_PRODUCT_MASTER', 'COMMERCE_OWNS_PRODUCT_IMAGES', 'COMMERCE_OWNS_PROMOTIONS',
  'COMMERCE_OWNS_STAFF',
  'WINBACK_REPORTS_SOURCE', 'RESTAURANTS_SOURCE', 'BESTSELLERS_SOURCE', 'SALES_SOURCE', 'GROWTH_SOURCE',
  'ORDERS_SOURCE', 'PUSH_CAMPAIGNS_SOURCE', 'MARKETING_WORKFLOWS_SOURCE', 'PRODUCTS_SOURCE',
  'CRON_JAGOTA_SYNC_IMPORT_ENABLED', 'CRON_JOSH_ORDER_COPY_ENABLED', 'CRON_JOSH_CATALOG_SYNC_ENABLED',
  'CRON_STAFF_PRICES_IMPORT_ENABLED',
  'S3_MEDIA_BUCKET', 'MEDIA_BASE_URL', 'AWS_REGION',
];

const SECRETS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'WINBACK_INTAKE_KEY'];

function walk(dir: string, hit: (file: string, text: string) => void) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, hit);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) hit(p, fs.readFileSync(p, 'utf8'));
  }
}

describe('prod cutover env passthrough', () => {
  const code = new Set<string>();
  beforeAll(() => {
    walk(path.join(__dirname), (_f, text) => {
      for (const m of text.matchAll(/(?:process\.env|\benv)\.([A-Z][A-Z0-9_]*)/g)) code.add(m[1]);
      for (const m of text.matchAll(/['"]([A-Z][A-Z0-9_]*)['"]/g)) code.add(m[1]);
    });
  });

  it('leaves non-secret cutover flags to platform-flags.env and the code reads each one', () => {
    expect(compose).toContain('platform-flags.env');
    expect(deploy).toContain('PLATFORM_FLAGS');
    expect(deploy).toContain('PLATFORM_FLAGS must not carry secrets');
    for (const k of VIA_FLAGS) {
      expect(envKeys.has(k)).toBe(false);
      expect(code.has(k)).toBe(true);
    }
  });

  it('wires media and intake secrets through deploy into the platform environment', () => {
    const loop = deploy.match(/for v in[\s\S]*?done/)?.[0] ?? '';
    for (const k of SECRETS) {
      expect(envKeys.has(k)).toBe(true);
      expect(deploy).toContain(`${k}: \${{ secrets.${k} }}`);
      expect(loop).toContain(k);
      expect(code.has(k)).toBe(true);
    }
  });
});

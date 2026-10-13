// Uses the established isolated fixture harness with the complete current route inventory.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const original = 'apps/commerce-admin/e2e/table-redesign-review.mjs';
let source = readFileSync(original, 'utf8');
const hash = createHash('sha256').update(source).digest('hex');
const replace = (before, after) => { assert.ok(source.includes(before), `Fixture harness changed: ${before}`); source = source.replace(before, after); };
replace("readFileSync('docs/reviews/table-page-inventory-2026-10-09.json', 'utf8')", "readFileSync('docs/reviews/e2e-ux-20261013/every-page-inventory.json', 'utf8')");
replace("route.path.replace(/:\\w+/g, id(1))", "route.path.replace(/:(\\w+)/g, (_match, name) => name === 'decision' ? 'approved' : id(1))");
replace('visit.actualPath !== path ||', 'visit.actualPath !== (route.expectedPath ?? path) ||');
replace('portalRoutes: 4,', "portalRoutes: inventory.routes.filter(route => route.app === 'portal').length,");
replace('const previews = new Set([', "const previews = new Set(['/j/marketing/welcome-lead-email','/erp/simulator','/marketing/flows/new','/tasks/catalog','/tasks/advanced','/j/cs/notification-log',");
replace("({ locale, claims, app }) => {\n      sessionStorage.setItem", "({ locale, claims, app }) => {\n      if (window !== window.top) return;\n      sessionStorage.setItem");
replace('errors.push({ locale, viewport, message: error.message })', 'errors.push({ locale, viewport, path: new URL(page.url()).pathname, message: error.message })');
const temp = resolve('.e2e-out/comprehensive-page-review'); mkdirSync(temp, { recursive: true });
const generated = resolve(temp, 'run.mjs'); writeFileSync(generated, source);
const out = resolve(process.env.TABLE_REVIEW_OUT ?? 'docs/reviews/e2e-ux-20261013/complete-pages'); mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'harness.json'), JSON.stringify({ source: original, sourceSha256: hash, fixtureMode: 'All API and external requests intercepted. Unsupported API contracts produce unavailable states, not successful-data claims.' }, null, 2));
const child = spawn(process.execPath, [generated], { stdio: 'inherit', env: { ...process.env, TABLE_REVIEW_OUT: out, TABLE_REVIEW_WORKFLOWS: 'false' } });
process.exitCode = await new Promise((done, fail) => { child.on('error', fail); child.on('exit', code => done(code ?? 1)); });
if (!process.exitCode && !process.env.TABLE_REVIEW_PATHS) {
  const inventory = JSON.parse(readFileSync('docs/reviews/e2e-ux-20261013/every-page-inventory.json', 'utf8'));
  const result = JSON.parse(readFileSync(resolve(out, 'after-results.json'), 'utf8'));
  assert.equal(result.visits.length, inventory.routes.length * 4, 'Every route in both languages and both viewports');
}

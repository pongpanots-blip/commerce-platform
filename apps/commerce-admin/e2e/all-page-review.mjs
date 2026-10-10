/** Serial read-only page review, derived from upstream's local fixture harness.
 * Every API/external request is intercepted; this checks layout/reachability, not live acceptance.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const sourcePath='apps/commerce-admin/e2e/table-redesign-review.mjs';
let source=readFileSync(sourcePath,'utf8');
const upstreamHash=createHash('sha256').update(source).digest('hex');
const replace=(before,after)=>{assert(source.includes(before),`Upstream harness changed: missing ${before.slice(0,70)}`);source=source.replace(before,after);};
replace("readFileSync('docs/reviews/table-page-inventory-2026-10-09.json', 'utf8')","readFileSync('docs/reviews/admin-task-navigation/every-page-inventory.json', 'utf8')");
replace("await Promise.all(\n    ['th', 'en'].flatMap((locale) =>\n      ['desktop', 'phone'].map(async (viewport) => {","for (const locale of ['th', 'en'])\n    for (const viewport of ['desktop', 'phone']) {");
replace("      }),\n    ),\n  );\n}\n\nasync function workflows()","      }\n}\n\nasync function workflows()");
replace("route.path.replace(/:\\w+/g, id(1))","route.path.replace(/:(\\w+)/g, (_match, name) => name === 'decision' ? 'approved' : id(1))");
replace("portalRoutes: 4,","portalRoutes: inventory.routes.filter(route => route.app === 'portal').length,");
replace("({ locale, claims, app }) => {\n      sessionStorage.setItem", "({ locale, claims, app }) => {\n      if (window !== window.top) return; // Fixture identity belongs only to the application frame.\n      sessionStorage.setItem");
replace("errors.push({ locale, viewport, message: error.message })", "errors.push({ locale, viewport, path: new URL(page.url()).pathname, message: error.message })");
const temp=resolve('.e2e-out/combined-page-review');mkdirSync(temp,{recursive:true});
const generated=resolve(temp,'generated-page-review.mjs');writeFileSync(generated,source);
const requestedPaths=process.env.ALL_PAGE_REVIEW_PATHS?.split(',').filter(Boolean);
const output=resolve(`docs/reviews/admin-task-navigation/combined-browser/${requestedPaths?'supplemental':'all-pages'}`);mkdirSync(output,{recursive:true});
writeFileSync(resolve(output,'harness.json'),JSON.stringify({upstreamHarness:sourcePath,upstreamSha256:upstreamHash,derivedSha256:createHash('sha256').update(source).digest('hex'),changes:['Complete current page inventory','Serial locale/viewport loops; one page/context at a time','Valid sample decision parameter','Accurate portal route count','Fixture identity injected only into top-level app frame','Page errors retain their active route'],apiMode:'All API and external requests intercepted local fixtures; no live service writes'},null,2)+'\n');
const environment={...process.env,TABLE_REVIEW_OUT:output,TABLE_REVIEW_PHASE:'after',TABLE_REVIEW_WORKFLOWS:'false',TABLE_REVIEW_WORKFLOWS_ONLY:'false'};
if(requestedPaths)environment.TABLE_REVIEW_PATHS=requestedPaths.join(',');else delete environment.TABLE_REVIEW_PATHS;
const child=spawn(process.execPath,[generated],{stdio:'inherit',env:environment});
process.exitCode=await new Promise((resolveExit,reject)=>{child.on('error',reject);child.on('exit',code=>resolveExit(code??1));});
if(process.exitCode===0){
  const inventory=JSON.parse(readFileSync('docs/reviews/admin-task-navigation/every-page-inventory.json','utf8'));
  const result=JSON.parse(readFileSync(resolve(output,'after-results.json'),'utf8'));
  const checkedRoutes=requestedPaths?inventory.routes.filter(route=>route.app==='admin'&&requestedPaths.includes(route.path)):inventory.routes;
  assert.equal(result.visits.length,checkedRoutes.length*4,'Every requested page receives TH/EN desktop/phone visits');
}

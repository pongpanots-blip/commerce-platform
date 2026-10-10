// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setUiLocale } from '@cp/ui';
import { api } from '../../../lib/api';
import { GUIDED_PREVIEWS } from '../../../../../commerce-platform/src/modules/integration/analytics-foundation/guided-previews';
import { GUIDED_ANALYSIS_API as endpoint, GUIDED_ANALYSIS_HOME as home, fixtureGuidedPreview, guidedSearch, guidedTemplatePath, missingContractIds, normalizeGuidedQuery, unavailableGuidedPreview } from '../../../../../commerce-platform/src/modules/integration/guided-analysis/guided-analysis.contracts';
import type { FixtureSegmentPreview } from '../../../../../commerce-platform/src/modules/integration/analytics-foundation/fixture-executor';
import GuidedAnalysisWorkspace from './GuidedAnalysisWorkspace';

let role = 'business_analyst', root: Root, container: HTMLDivElement;
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }, session: { claims: () => ({ sub: 'guided-fixture', role }) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const repeat = normalizeGuidedQuery({ template: 'repeat_buyers_inactive' }), first = normalizeGuidedQuery({ template: 'approved_without_order' });
const catalog = () => ({ schemaVersion: 1, templates: GUIDED_PREVIEWS, mode: 'live_unavailable', missingContracts: [...missingContractIds], activationAllowed: false, liveIntegrationComplete: false, operationalWrites: false });
const content = () => container.textContent ?? '';
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label)!;
function TestLocation() {
  const l = useLocation(), n = useNavigate();
  return <><output>{l.pathname + l.search}</output><button onClick={() => n(-1)}>Back test</button><button onClick={() => n(1)}>Forward test</button><button onClick={() => n(home)}>Home test</button><button onClick={() => n(guidedTemplatePath(repeat, 'preview'))}>Repeat test</button></>;
}
async function render(r = 'business_analyst', entry = home) {
  role = r;
  await act(async () => root.render(<MemoryRouter initialEntries={[entry]}><TestLocation /><Routes><Route path={home + '/*'} element={<GuidedAnalysisWorkspace role={r} />} /></Routes></MemoryRouter>));
}
async function click(label: string) { await act(async () => button(label).click()); }
async function link(href: string) { await act(async () => container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!.click()); }
async function fill(name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
function previewCalls() { return vi.mocked(api.get).mock.calls.filter(([url]) => url.startsWith(endpoint + '/preview')); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.resetAllMocks(); setUiLocale('en'); localStorage.clear(); sessionStorage.clear();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.mocked(api.get).mockImplementation(async url => url === endpoint + '/templates' ? catalog() : unavailableGuidedPreview(normalizeGuidedQuery(Object.fromEntries(new URL(url, 'http://fixture').searchParams))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it.each(['admin', 'business_analyst'])('%s sees one guided template entry and explicit live limitations', async r => {
  await render(r); expect(content()).toContain('Live source unavailable'); expect(container.querySelectorAll('a[href*="/templates/"]')).toHaveLength(2);
  expect(api.get).toHaveBeenCalledWith(endpoint + '/templates'); expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
});
it.each(['marketing', 'merchandising', 'sale', 'sales_manager', 'cs', 'graphic'])('%s direct links deny before template or evidence reads', async r => {
  await render(r, guidedTemplatePath(repeat, 'evidence')); expect(content()).toContain('cannot read'); expect(api.get).not.toHaveBeenCalled();
});
it('plain labeled whole-number inputs lead through server validation to a distinct preview URL', async () => {
  await render('business_analyst', guidedTemplatePath(repeat));
  for (const input of container.querySelectorAll<HTMLInputElement>('input')) { expect(container.querySelector(`label[for="${input.id}"]`)).not.toBeNull(); expect(input.getAttribute('aria-describedby')).toBeTruthy(); expect(input.min).not.toBe(''); }
  await fill('minimumOrders', '4'); await fill('purchaseWindowDays', '30'); await fill('inactiveDays', '7'); await submit();
  const q = normalizeGuidedQuery({ template: repeat.template, minimumOrders: 4, purchaseWindowDays: 30, inactiveDays: 7 });
  expect(container.querySelector('output')!.textContent).toBe(guidedTemplatePath(q, 'preview'));
  expect(api.get).toHaveBeenCalledWith(endpoint + '/preview' + guidedSearch(q));
  expect(content()).toContain('At least 4 confirmed orders over 30 days'); expect(content()).toContain('Criteria checked; live source unavailable');
  expect(content()).not.toContain('Saved successfully'); expect(content()).not.toContain('SQL'); expect(content()).not.toContain('schemaVersion');
});
it('invalid cross-window input keeps fields and never sends a preview request', async () => {
  await render('business_analyst', guidedTemplatePath(repeat)); await fill('purchaseWindowDays', '7'); await fill('inactiveDays', '14'); await submit();
  expect(content()).toContain('Inactivity must fit inside'); expect(container.querySelector<HTMLInputElement>('[name="purchaseWindowDays"]')!.value).toBe('7'); expect(previewCalls()).toHaveLength(0);
});
it.each([
  home + '?tenantId=other', home + '/templates/unknown', home + '/templates/repeat_buyers_inactive?tenantId=other',
  home + '/templates/repeat_buyers_inactive/preview?inactiveDays=7&inactiveDays=14', home + '/templates/repeat_buyers_inactive/preview?template=approved_without_order',
  home + '/templates/repeat_buyers_inactive/evidence?inactiveDays=0', home + '/activate',
])('invalid/overriding route %s never reads a source', async entry => {
  await render('business_analyst', entry); expect(content()).toContain('Check analysis criteria'); expect(api.get).not.toHaveBeenCalled();
});
it('preview/evidence URLs preserve criteria through back and forward', async () => {
  await render('business_analyst', guidedTemplatePath(repeat, 'preview')); await link(guidedTemplatePath(repeat, 'evidence'));
  expect(content()).toContain('Response time does not establish source freshness'); expect(content()).toContain('Authorized daily-trend source contract'); expect(content()).toContain('Verified personalization and measurement contracts');
  expect(content()).toContain('No member list or zero count can be established');
  await click('Back test'); expect(content()).toContain('Journey steps for review');
  await click('Forward test'); expect(content()).toContain('Branch evidence');
  expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
});
it('a genuinely empty template response has useful retry guidance', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...catalog(), templates: [] }); await render(); expect(content()).toContain('No templates returned');
  vi.mocked(api.get).mockResolvedValue(catalog()); await click('Try again'); expect(container.querySelectorAll('a[href*="/templates/"]')).toHaveLength(2);
});
it('template failure has explicit retry and source counts never masquerade as zero', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(Error('upstream detail')); await render(); expect(content()).toContain('Templates could not be read');
  await click('Try again'); expect(content()).toContain('Live source unavailable'); await link(guidedTemplatePath(repeat)); await submit();
  expect(content()).toContain('Unavailable'); expect(content()).not.toContain('Included branches0');
});
it('form read failure preserves inputs and a deliberate retry can continue', async () => {
  await render('business_analyst', guidedTemplatePath(repeat)); await fill('minimumOrders', '5');
  vi.mocked(api.get).mockRejectedValueOnce(Error('failed')); await submit(); expect(content()).toContain('Analysis could not be read');
  expect(container.querySelector<HTMLInputElement>('[name="minimumOrders"]')!.value).toBe('5'); await submit(); expect(content()).toContain('At least 5 confirmed orders');
});
it('duplicate submissions use one synchronous validation lock', async () => {
  await render('business_analyst', guidedTemplatePath(repeat)); const pending = deferred<unknown>(); vi.mocked(api.get).mockImplementationOnce(() => pending.promise);
  await act(async () => { const form = container.querySelector('form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(previewCalls()).toHaveLength(1); expect(button('Checking criteria…').disabled).toBe(true);
  await act(async () => pending.resolve(unavailableGuidedPreview(repeat))); expect(content()).toContain('Criteria checked'); expect(api.post).not.toHaveBeenCalled();
});
it('late form validation cannot redirect a newer navigation', async () => {
  await render('business_analyst', guidedTemplatePath(first)); const pending = deferred<unknown>(); vi.mocked(api.get).mockImplementationOnce(() => pending.promise); await submit(); await click('Home test');
  await act(async () => pending.resolve(unavailableGuidedPreview(first))); expect(container.querySelector('output')!.textContent).toBe(home); expect(content()).toContain('Choose a question');
});
it('loading and retry replace prior result claims; mismatched returned criteria are rejected', async () => {
  const pending = deferred<unknown>(); vi.mocked(api.get).mockImplementationOnce(() => pending.promise); await render('business_analyst', guidedTemplatePath(repeat, 'preview'));
  expect(content()).not.toContain('Criteria checked'); await act(async () => pending.resolve(unavailableGuidedPreview(first))); expect(content()).toContain('Analysis could not be read');
  await click('Try again'); expect(content()).toContain('Criteria checked; live source unavailable');
});
it('superseded source responses cannot replace the current template', async () => {
  const pending = deferred<unknown>(); vi.mocked(api.get).mockImplementationOnce(() => pending.promise); await render('business_analyst', guidedTemplatePath(first, 'preview')); await click('Repeat test');
  expect(content()).toContain('At least 3 confirmed orders over 90 days'); await act(async () => pending.resolve(unavailableGuidedPreview(first)));
  expect(content()).toContain('At least 3 confirmed orders over 90 days'); expect(content()).not.toContain('Approval evidence is at least');
});
it('invalid partial count responses cannot claim evaluated evidence', async () => {
  const value = unavailableGuidedPreview(repeat); vi.mocked(api.get).mockResolvedValue({ ...value, counts: { matched: 0, excluded: null, unknown: null } });
  await render('business_analyst', guidedTemplatePath(repeat, 'preview')); expect(content()).toContain('Analysis could not be read'); expect(content()).not.toContain('Criteria checked');
});
it('Thai form labels retain the exact validated values and limits', async () => {
  setUiLocale('th'); await render('business_analyst', guidedTemplatePath(first)); expect(content()).toContain('อนุมัติแล้วอย่างน้อยกี่วัน');
  expect(container.querySelector<HTMLInputElement>('[name="approvalAgeDays"]')!.value).toBe('7'); expect(container.querySelector<HTMLInputElement>('[name="historyLimitDays"]')!.max).toBe('365');
});
it('synthetic unknown counts and observed zero remain distinct from unavailable live data', async () => {
  const f: FixtureSegmentPreview = { schemaVersion: 1, ruleVersion: 1, evaluatedAt: '2026-10-09T00:00:00.000Z', mode: 'synthetic_fixture', matchedCount: 0, excludedCount: 0, unknownCount: 1, branches: [{ branchId: 'fixture_branch', companyId: 'fixture_company', result: 'unknown', reasons: [{ result: 'unknown', description: 'Missing history', observedCount: null }] }], dataFreshness: { source: 'synthetic_fixture', coverageAssertions: [], profileAsOf: [{ branchId: 'fixture_branch', asOf: null }], note: 'Fixture only' }, activationAllowed: false, liveIntegrationComplete: false };
  vi.mocked(api.get).mockResolvedValue(fixtureGuidedPreview(repeat, f)); await render('business_analyst', guidedTemplatePath(repeat, 'evidence'));
  expect(content()).toContain('Synthetic fixture evaluation'); expect(content()).toContain('Unknown branches1'); expect(content()).toContain('Verified observed count: Unknown');
  expect(content()).toContain('No interval coverage assertions'); expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
});

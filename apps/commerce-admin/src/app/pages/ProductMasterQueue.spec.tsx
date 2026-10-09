// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setUiLocale } from '@cp/ui';
import { productMastersApi, productPricesApi } from '../../lib/api';
import { ProductMasterQueue } from './ProductMasterQueue';

vi.mock('../../lib/api', () => ({ session: { claims: () => ({sub:'fixture',role:'merchandising'}) }, productPricesApi: { ownership: vi.fn() }, productMastersApi: { pending: vi.fn(), approve: vi.fn(), reject: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const page = { items: [{ sku: 'SKU-1', current: { pack_size: 1 }, patch: { pack_size: 2 }, received_at: '2026-10-09T00:00:00Z' }], total: 1, page: 1, limit: 20 };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const buttons = () => [...container.querySelectorAll('button')];
const approve = () => buttons().find(button => button.textContent?.startsWith('Approve'))!;
const reject = () => buttons().find(button => button.textContent === 'Reject')!;
async function render() { await act(async () => root.render(<MemoryRouter><ProductMasterQueue /></MemoryRouter>)); }
async function select() { await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click()); }
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); setUiLocale('en');
  vi.mocked(productPricesApi.ownership).mockResolvedValue({ productMaster: true } as Awaited<ReturnType<typeof productPricesApi.ownership>>);
  vi.mocked(productMastersApi.pending).mockResolvedValue(page);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setUiLocale('th'); });

it('does not show zero pending or an empty result before the initial read completes', async () => {
  const request = deferred<typeof page>(); vi.mocked(productMastersApi.pending).mockReturnValueOnce(request.promise);
  await render();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.textContent).not.toContain('No data');
  expect(container.textContent).not.toContain('(0)');
  await act(async () => request.resolve(page));
  expect(container.textContent).toContain('SKU-1');
});

it('locks approval and rejection together and reports the persisted backend count', async () => {
  const request = deferred<{ approved: number }>(); vi.mocked(productMastersApi.approve).mockReturnValueOnce(request.promise);
  await render(); await select();
  const approveButton = approve(); const rejectButton = reject();
  await act(async () => { approveButton.click(); approveButton.click(); rejectButton.click(); });
  expect(productMastersApi.approve).toHaveBeenCalledTimes(1);
  expect(productMastersApi.approve).toHaveBeenCalledWith(['SKU-1']);
  expect(productMastersApi.reject).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')).toBeNull();
  await act(async () => request.resolve({ approved: 0 }));
  expect(container.textContent).toContain('Approved 0 products');
  expect(container.querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('Select SKU-1');
  expect(approve().disabled).toBe(true);
});

it('keeps selection after a failed write and retries the same business payload', async () => {
  vi.mocked(productMastersApi.reject).mockRejectedValueOnce(Object.assign(new Error('Write failed'), {status:409})).mockResolvedValueOnce({ rejected: 1 });
  await render(); await select();
  await act(async () => reject().click());
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  expect(container.textContent).not.toContain('Rejected 1 records');
  await act(async () => reject().click());
  expect(productMastersApi.reject).toHaveBeenNthCalledWith(2, ['SKU-1']);
  expect(container.textContent).toContain('Rejected 1 records');
});

it('blocks writes if ownership is unknown and exposes retry for that read', async () => {
  vi.mocked(productPricesApi.ownership).mockRejectedValueOnce(new Error('Ownership unavailable'));
  await render(); await select();
  expect(approve().disabled).toBe(true);
  await act(async () => buttons().find(button => button.textContent === 'Try again')!.click());
  expect(approve().disabled).toBe(false);
});

it('does not treat failed refresh as an empty queue or allow writes against stale rows', async () => {
  vi.mocked(productMastersApi.approve).mockResolvedValue({ approved: 1 });
  vi.mocked(productMastersApi.pending).mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('Refresh failed')).mockResolvedValueOnce({ ...page, items: [], total: 0 });
  await render(); await select();
  await act(async () => approve().click());
  expect(container.textContent).toContain('Approved 1 products');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector('table')).toBeNull();
  expect(approve().disabled).toBe(true);
  await act(async () => buttons().find(button => button.textContent === 'Try again')!.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain('No pending');
});

it.each([null, {}, {approved:-1}, {approved:1.5}, {status:false,approved:1}, {rejected:1}, {approved:2}])('rejects unconfirmed approval receipt %j without clearing selected SKUs', async value => {
  vi.mocked(productMastersApi.approve).mockResolvedValueOnce(value as never);
  await render(); await select(); await act(async () => approve().click());
  expect(container.textContent).not.toContain('Approved 1 products');
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it('an uncertain approval requires a fresh read and fresh selection rather than reusing the old patch', async () => {
  vi.mocked(productMastersApi.approve).mockRejectedValueOnce(new Error('Lost response'));
  await render(); await select(); await act(async()=>approve().click());
  expect(approve().disabled).toBe(true);
  await act(async()=>buttons().find(button=>button.textContent==='Check current data')!.click());
  expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  await act(async()=>buttons().find(button=>button.textContent==='I checked and want to retry')!.click());
  expect(approve().disabled).toBe(true);await select();expect(approve().disabled).toBe(false);
});

it('displays the requested rejection count when a receipt includes both count keys', async () => {
  vi.mocked(productMastersApi.reject).mockResolvedValueOnce({approved:1,rejected:0} as never);
  await render();await select();await act(async()=>reject().click());
  expect(container.textContent).toContain('Rejected 0 records');expect(container.textContent).not.toContain('Rejected 1 records');
});

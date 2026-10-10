// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { setUiLocale } from '@cp/ui';
import { api, inventoryOverviewApi, joshAdmin, joshProductApi, reportsApi } from '../../lib/api';
import { RoleOverview, catalogPriceCoverage, sampleHomeRows, countValue } from './RoleOverview';
vi.mock('../../lib/api', () => ({ api: { get: vi.fn() }, inventoryOverviewApi: { get: vi.fn() }, joshAdmin: { get: vi.fn() }, joshProductApi: { list: vi.fn(), summary: vi.fn() }, reportsApi: { sales: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
HTMLDialogElement.prototype.close ??= function () { this.open = false; };
let container: HTMLDivElement, root: Root;
const content = () => container.textContent ?? '';
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!;
async function render(role: string) { await act(async () => root.render(<MemoryRouter><RoleOverview role={role} /></MemoryRouter>)); }
beforeEach(() => {
  vi.clearAllMocks(); setUiLocale('en');
  vi.mocked(api.get).mockResolvedValue({ schemaVersion: 1, role: 'marketing', metrics: [] });
  vi.mocked(joshProductApi.summary).mockResolvedValue({ total: 10, no_price: 3, no_category: 2, out_of_stock: 1 } as never);
  vi.mocked(joshProductApi.list).mockResolvedValue({ items: [], total: 0, page: 1, limit: 12 });
  vi.mocked(reportsApi.sales).mockResolvedValue({ totals: { revenue_inc_vat: 200, orders: 2, average_order_inc_vat: 100 }, byDay: [{ bucket: '2026-10-09', revenue_inc_vat: 200, orders: 2 }], topProducts: [] } as never);
  vi.mocked(inventoryOverviewApi.get).mockResolvedValue({ warehouses: [], items: [], total: 0, page: 1, pageSize: 50 });
  vi.mocked(joshAdmin.get).mockResolvedValue({ data: { items: [{ id: 'sample-1', status: 'pending', company_name: 'Fixture customer' }] } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setUiLocale('th'); vi.restoreAllMocks(); });
it('derives only defined catalog coverage and preserves zero/unknown distinctions', () => {
  expect(catalogPriceCoverage(10, 3)).toEqual({ present: 7, total: 10 });
  expect(catalogPriceCoverage(0, 0)).toEqual({ present: 0, total: 0 });
  for (const pair of [[10, 11], [10, null], [null, 0], [10, -1], [1.5, 0]]) expect(catalogPriceCoverage(...pair)).toBeUndefined();
  expect(countValue(0)).toBe(0); expect(countValue('0')).toBeUndefined(); expect(countValue(NaN)).toBeUndefined();
});
it('uses authorized MER catalog observations with an explicit denominator and no competitor/cost claims', async () => {
  await render('merchandising'); expect(content()).toContain('7 / 10'); expect(content()).toContain('Positive prices; correctness is not verified'); expect(content()).toContain('not verified live availability'); expect(content()).toContain('Authoritative costs and competitor access are not established'); expect(joshProductApi.list).toHaveBeenCalledWith({ page: 1, limit: 12 }); expect(reportsApi.sales).not.toHaveBeenCalled(); expect(joshAdmin.get).not.toHaveBeenCalled();
});
it('does not turn failed MER summary into zero and retries the source', async () => {
  vi.mocked(joshProductApi.summary).mockRejectedValueOnce(new Error('Catalog source unavailable')); await render('merchandising'); expect(content()).toContain('Catalog source unavailable'); expect(content()).not.toContain('7 / 10'); await act(async () => button('Try again').click()); expect(content()).toContain('7 / 10');
});
it('keeps catalog metrics when its independent record list fails', async () => { vi.mocked(joshProductApi.list).mockRejectedValueOnce(new Error('Records unavailable')); await render('merchandising'); expect(content()).toContain('7 / 10'); expect(content()).toContain('Records unavailable'); expect(content()).not.toContain('No catalog records yet'); });
it('does not call a malformed catalogue response a verified empty list', async () => { vi.mocked(joshProductApi.list).mockResolvedValueOnce({} as never); await render('merchandising'); expect(content()).toContain('could not be verified'); expect(content()).not.toContain('No catalog records yet'); });
it('requests personal sales without any user-controlled team override and leaves profit unavailable', async () => { await render('sale'); expect(reportsApi.sales).toHaveBeenCalledWith({ period: 'this_month' }); expect(inventoryOverviewApi.get).toHaveBeenCalledWith('', '', 1); expect(content()).toContain('assigned companies only'); expect(content()).toContain('Authoritative COGS and compatible net sales are unavailable'); expect(container.querySelector('a[href="/reports/winback/my"]')).not.toBeNull(); expect(container.querySelector('a[href="/cs/sales-assignment"]')).toBeNull(); });
it.each(['sales_manager', 'business_analyst'])('%s sees scoped sales, never personal inventory or restricted product-detail links', async role => { await render(role); expect(reportsApi.sales).toHaveBeenCalledWith({ period: 'this_month' }); expect(inventoryOverviewApi.get).not.toHaveBeenCalled(); expect(joshProductApi.summary).not.toHaveBeenCalled(); expect(container.querySelector('a[href^="/reports/products/"]')).toBeNull(); expect(!!container.querySelector('a[href="/cs/sales-assignment"]')).toBe(role === 'sales_manager'); });
it.each(['marketing', 'graphic'])('%s does not fetch unapproved summaries and exposes useful existing routes', async role => { await render(role); expect(reportsApi.sales).not.toHaveBeenCalled(); expect(joshProductApi.summary).not.toHaveBeenCalled(); expect(joshAdmin.get).not.toHaveBeenCalled(); expect(content()).toContain('Unavailable'); if (role === 'marketing') expect(content()).toContain('Spend and attributed sales are unavailable'); else expect(container.querySelector('a[href="/j/product/bulk-image-upload"]')).not.toBeNull(); });
it('bases the CS badge on returned pending records, not on menu destinations or total workload', async () => { await render('cs'); expect(joshAdmin.get).toHaveBeenCalledWith('/cs-admin/sample-requests', { status: 'pending' }); expect(content()).toContain('Fixture customer'); expect(content()).toContain('Returned records only; not total service workload'); expect(container.querySelector('a[href="/cs/accounts/merge"]')).toBeNull(); expect(container.querySelector('a[href="/j/payment-transactions"]')).toBeNull(); });
it('rejects CS business-error envelopes and malformed rows rather than claiming a verified empty queue', async () => { expect(() => sampleHomeRows({ status: false, data: [] })).toThrow(); expect(() => sampleHomeRows({ data: { items: [{}] } })).toThrow(); vi.mocked(joshAdmin.get).mockResolvedValueOnce({ status: false, data: [] }); await render('cs'); expect(content()).toContain('Sample requests unavailable'); expect(content()).not.toContain('No pending sample requests in this response'); });
it('does not show data for an unrecognized role', async () => { await render('unrecognized'); expect(reportsApi.sales).not.toHaveBeenCalled(); expect(joshAdmin.get).not.toHaveBeenCalled(); expect(container.querySelector('a')).toBeNull(); });

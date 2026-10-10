// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  role: 'admin',
  updateCustomer: vi.fn(async () => ({})),
  list: vi.fn(async (f: { kind: string; scopeId?: string }) => ({
    items: f.kind === 'customer'
      ? [{ id: 'p1', kind: 'customer', companyId: 'c1', branchId: null, productInventoryId: 'inv-1', sku: 'SKU-1', price: 100, startDate: '2026-01-01', endDate: null, status: 'synced' }]
      : [{ id: 'p2', kind: 'contract', companyId: null, branchId: f.scopeId, productInventoryId: 'inv-2', sku: 'SKU-2', price: 80, startDate: '2026-02-01', endDate: '2026-12-31', status: 'pending' }],
    total: 1, limit: 100,
  })),
}));
vi.mock('../../lib/api', () => ({
  session: { claims: () => ({ role: api.role }) },
  joshActionsApi: { updateCustomer: api.updateCustomer },
  staffPricesApi: { list: api.list },
}));
import { CompanyTermsPrices } from './CompanyTermsPrices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const company = {
  id: 'c1', credit_term_days: 30,
  branches: [{ id: 'b1', name: 'สาขาหนึ่ง', credit_term: null }],
  creditApplications: [{ status: 'PENDING' }],
};
let root: Root;
let host: HTMLDivElement;
const onSaved = vi.fn();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const mount = async () => {
  act(() => { root = createRoot(host); root.render(<MemoryRouter><CompanyTermsPrices company={company} onSaved={onSaved} /></MemoryRouter>); });
  await flush();
};
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);

beforeEach(() => { api.role = 'admin'; host = document.createElement('div'); document.body.append(host); vi.clearAllMocks(); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('shows the term, branch terms, the open-application warning and merged company + branch prices', async () => {
  await mount();
  const text = host.textContent ?? '';
  expect(text).toContain('30 วัน');
  expect(text).toContain('สาขาหนึ่ง: ตามบริษัท');
  expect(text).toContain('PENDING');
  expect(api.list).toHaveBeenCalledWith({ kind: 'customer', scopeId: 'c1', page: 1 });
  expect(api.list).toHaveBeenCalledWith({ kind: 'contract', scopeId: 'b1', page: 1 });
  expect(text).toContain('SKU-1');
  expect(text).toContain('SKU-2');
  expect(text).toContain('สาขา สาขาหนึ่ง');
});

it('admin picks a preset, confirms, and the new term goes to josh', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await mount();
  act(() => button('แก้เทอม')!.click());
  act(() => button('45 วัน')!.click());
  await act(async () => { button('บันทึก')!.click(); });
  expect(api.updateCustomer).toHaveBeenCalledWith('companies', 'c1', { credit_term_days: 45 });
  expect(onSaved).toHaveBeenCalled();
});

it('rejects an out-of-range custom term and hides editing and prices from roles without access', async () => {
  await mount();
  act(() => button('แก้เทอม')!.click());
  const input = host.querySelector('input') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '400');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(button('บันทึก')!.disabled).toBe(true);
  act(() => root.unmount());
  api.role = 'cs';
  vi.clearAllMocks();
  await mount();
  expect(button('แก้เทอม')).toBeUndefined();
  expect(api.list).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  total: 250,
  getOrders: vi.fn(),
  downloadCsv: vi.fn(),
}));
const row = (n: number) => ({ orders_id: `id-${n}`, order_id: `ORD-${n}`, customer_name: `C${n}`, total_price: n, status: 'paid', branch: 'B', delivery_slot: 'AM', date: '2026-10-01' });
vi.mock('@josh/shared-api', () => ({
  getOrderAnalytics: vi.fn(async () => ({ data: null })),
  getOrders: m.getOrders,
}));
vi.mock('@cp/ui', async (original) => ({ ...(await original<typeof import('@cp/ui')>()), downloadCsv: m.downloadCsv }));
vi.mock('../../../app/role-can', () => ({ roleCanWrite: () => false }));
import Order from './Order';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  m.getOrders.mockImplementation(async ({ page, limit }: { page: number; limit: number }) => {
    const from = (page - 1) * limit;
    const rows = Array.from({ length: Math.max(0, Math.min(limit, m.total - from)) }, (_, i) => row(from + i + 1));
    return { status: 200, data: { status: true, data: { data: rows, meta: { total: m.total } } } };
  });
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('exports every order matching the filters across pages, in visible columns, with status labels', async () => {
  act(() => { root = createRoot(host); root.render(<MemoryRouter><Order /></MemoryRouter>); });
  await flush();
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('CSV'))!;
  expect(button.disabled).toBe(false);
  await act(async () => { button.click(); });
  await flush();
  const exportCalls = m.getOrders.mock.calls.filter(([p]) => p.limit === 100);
  expect(exportCalls.map(([p]) => p.page)).toEqual([1, 2, 3]);
  expect(m.downloadCsv).toHaveBeenCalledTimes(1);
  const [rows, cols, filename] = m.downloadCsv.mock.calls[0];
  expect(rows).toHaveLength(250);
  expect(rows[0].status).not.toBe('paid');
  expect(cols.map((c: { key: string }) => c.key)).not.toContain('actions');
  expect(filename).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.csv$/);
});

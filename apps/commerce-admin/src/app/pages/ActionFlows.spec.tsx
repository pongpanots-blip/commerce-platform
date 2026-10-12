// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { setUiLocale } from '@cp/ui';
import { api, stockApi, staffApi, inventoryOverviewApi } from '../../lib/api';
import { StockMoves, stockTaskBody, validateStockTask, type StockDraft } from './StockMoves';
import { ResourcePage } from '../components/ResourcePage';
import { StaffAccounts } from './StaffAccounts';
import { Integrations } from './Integrations';
import { TaskRoute } from '../TaskRoute';
vi.mock('../../lib/api', () => ({ session: { claims: () => ({ sub: 'fixture', role: 'admin' }) }, api: { base: '/api', get: vi.fn(), post: vi.fn() }, stockApi: { warehouses: vi.fn(), adjust: vi.fn(), transfer: vi.fn() }, inventoryOverviewApi: { get: vi.fn() }, staffApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), resetPassword: vi.fn() }, STAFF_ROLE_LABEL: { admin: 'Admin', marketing: 'Marketing', merchandising: 'Merchandising' } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
HTMLDialogElement.prototype.close ??= function () { this.open = false; };
HTMLElement.prototype.scrollIntoView = vi.fn();
let root: Root; let container: HTMLDivElement;
const own = [{ id: 'w1', code: 'A', name: 'Warehouse A', stockSource: 'commerce' as const, sellable: true }, { id: 'w2', code: 'B', name: 'Warehouse B', stockSource: 'commerce' as const, sellable: false }];
const form: StockDraft = { sku: ' SKU-1 ', warehouse: 'A', to: 'B', quantity: '2', reason: 'DAMAGE', note: ' note ' };
const applied = { status: 'applied', previousQuantity: 10, quantity: 12, reserved: 2 };
const text = () => container.textContent ?? '';
const button = (label: string) => [...container.querySelectorAll('button')].find(node => node.textContent?.trim() === label)!;
function Location() { const l = useLocation(); const navigate = useNavigate(); return <><output>{l.pathname + l.search + l.hash}</output><button onClick={() => navigate(-1)}>Back test</button><button onClick={() => navigate(1)}>Forward test</button></>; }
async function render(element: ReactNode, path: string, route = '*') {
  const base = ['/products','/customers','/settings/staff','/integrations','/stock-moves'].find(prefix => path.startsWith(prefix));
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Location /><Routes>
    {base ? <><Route path={base} element={<TaskRoute role="admin">{element}</TaskRoute>} /><Route path={`${base}/${base === '/stock-moves' ? ':task' : 'new'}`} element={<TaskRoute role="admin">{element}</TaskRoute>} /></> : <Route path={route} element={element} />}
  </Routes></MemoryRouter>));
}
async function input(name: string, value: string) {
  const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
async function submit(times = 1) { await act(async () => { for (let i = 0; i < times; i++) container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; }); return { resolve, reject, promise }; }
function stockDraft(task = 'receive', next = form, phase = 'editing') { sessionStorage.setItem(`cp-action-draft:fixture:stock:${task}`, JSON.stringify({ values: next, phase })); }
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); setUiLocale('en');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(stockApi.warehouses).mockResolvedValue(own); vi.mocked(stockApi.adjust).mockResolvedValue(applied);
  vi.mocked(staffApi.list).mockResolvedValue([]); vi.mocked(api.get).mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => { act(() => root.unmount()); container.remove(); setUiLocale('th'); vi.restoreAllMocks(); });

it.each(['en', 'th'] as const)('denied action shows its permission reason directly in %s before mounting feature reads', async locale => {
  setUiLocale(locale);
  await act(async () => root.render(<MemoryRouter initialEntries={['/products/new']}><TaskRoute role="sale"><StockMoves /></TaskRoute></MemoryRouter>));
  expect(container.querySelector('[role="alert"] p')?.textContent).toBe(locale === 'en' ? 'You do not have permission to open this page' : 'คุณไม่มีสิทธิ์เปิดหน้านี้');
  expect(container.querySelector('details')).toBeNull();
  expect(stockApi.warehouses).not.toHaveBeenCalled();
});

it.each(['', ' ', '1.1', 'Infinity', '1000001', '-1'])('receive refuses invalid quantity %j before any write', quantity => {
  expect(validateStockTask('receive', { ...form, quantity }, own).quantity).toBeTruthy();
});
it('preserves count zero, signed corrections and distinct owned warehouse business rules', () => {
  expect(validateStockTask('count', { ...form, quantity: '0' }, own)).toEqual({});
  expect(validateStockTask('adjust', { ...form, reason: 'CORRECTION', quantity: '-2' }, own)).toEqual({});
  expect(validateStockTask('transfer', { ...form, to: 'A' }, own).to).toBeTruthy();
  expect(validateStockTask('transfer', { ...form, warehouse: 'ERP' }, own).warehouse).toBeTruthy();
  expect(stockTaskBody('receive', form)).toEqual({ sku: 'SKU-1', warehouseCode: 'A', quantity: 2, mode: 'add', reason: 'RECEIVE', note: 'note' });
  expect(stockTaskBody('count', { ...form, quantity: '0' })).toMatchObject({ mode: 'set', quantity: 0, reason: 'COUNT' });
  expect(stockTaskBody('adjust', form)).toMatchObject({ quantity: -2, reason: 'DAMAGE' });
  expect(stockTaskBody('adjust', { ...form, reason: 'RETURN' })).toMatchObject({ quantity: 2, reason: 'RETURN' });
});
it('canonicalizes legacy stock URLs with query/hash and supports task back/forward', async () => {
  await render(<StockMoves />, '/stock-moves?source=old#form');
  expect(container.querySelector('output')?.textContent).toBe('/stock-moves/receive?source=old#form');
  const count = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-pressed') === 'false' && node.textContent?.includes('Count'))!;
  await act(async () => count.click());
  expect(container.querySelector('output')?.textContent).toContain('/stock-moves/count');
  await act(async () => button('Back test').click()); expect(container.querySelector('output')?.textContent).toContain('/stock-moves/receive');
  await act(async () => button('Forward test').click()); expect(container.querySelector('output')?.textContent).toContain('/stock-moves/count');
});
it('stock loading/failure/retry never exposes a writable false-empty form', async () => {
  const load = deferred<typeof own>(); vi.mocked(stockApi.warehouses).mockReturnValueOnce(load.promise);
  await render(<StockMoves />, '/stock-moves/receive');
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull(); expect(container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
  await act(async () => load.reject(new Error('Warehouse read failed')));
  expect(text()).toContain('Warehouse read failed'); expect(container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
  await act(async () => button('Try again').click()); expect(container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
});
it('stock duplicate submits are locked, and success waits for an applied receipt', async () => {
  stockDraft(); const write = deferred<typeof applied>(); vi.mocked(stockApi.adjust).mockReturnValueOnce(write.promise);
  await render(<StockMoves />, '/stock-moves/receive'); await submit(2);
  expect(stockApi.adjust).toHaveBeenCalledOnce(); expect(text()).not.toContain('Stock saved');
  await act(async () => write.resolve(applied)); expect(text()).toContain('12'); expect(sessionStorage.getItem('cp-action-draft:fixture:stock:receive')).toBeNull();
});
it('definite stock rejection keeps values and permits correction/retry', async () => {
  stockDraft(); vi.mocked(stockApi.adjust).mockRejectedValueOnce(Object.assign(new Error('Cannot reduce reserved stock'), { status: 409, details: { fieldErrors: { quantity: 'Keep reserved quantity available' } } }));
  await render(<StockMoves />, '/stock-moves/receive'); await submit();
  expect(container.querySelector<HTMLInputElement>('[name="quantity"]')!.value).toBe('2'); expect(container.querySelector('[name="quantity"]')!.getAttribute('aria-invalid')).toBe('true');
  await input('quantity','3'); await submit(); expect(stockApi.adjust).toHaveBeenCalledTimes(2);
});
it('lost stock responses require a successful current-data read and explicit retry acknowledgement', async () => {
  stockDraft(); vi.mocked(stockApi.adjust).mockRejectedValueOnce(new Error('Connection lost'));
  vi.mocked(inventoryOverviewApi.get).mockResolvedValue({ items: [{ sku: 'SKU-1', warehouseCode: 'A', quantity: 12, reserved: 2, lastStatus: 'applied' }], total: 1 } as never);
  await render(<StockMoves />, '/stock-moves/receive'); await submit();
  expect(button('I checked and want to retry').disabled).toBe(true); await submit(); expect(stockApi.adjust).toHaveBeenCalledOnce();
  await act(async () => button('Check current data').click()); expect(text()).toContain('12'); expect(text()).toContain('Applied');
  await act(async () => button('I checked and want to retry').click()); await submit(); expect(stockApi.adjust).toHaveBeenCalledTimes(2);
});
it('aborted stock form keeps unknown outcome, and a late response cannot clear its draft or announce success', async () => {
  stockDraft(); const write = deferred<typeof applied>(); vi.mocked(stockApi.adjust).mockReturnValueOnce(write.promise);
  await render(<StockMoves />, '/stock-moves/receive'); await submit();
  await act(async () => root.render(null)); await act(async () => write.resolve(applied));
  expect(JSON.parse(sessionStorage.getItem('cp-action-draft:fixture:stock:receive')!).phase).toBe('unknown');
  await render(<StockMoves />, '/stock-moves/receive'); expect(text()).toContain('Save outcome is unconfirmed'); expect(container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
});
it('transfer persists one unchanged contract with both confirmed warehouse receipts', async () => {
  stockDraft('transfer'); vi.mocked(stockApi.transfer).mockResolvedValue({ from: { ...applied, warehouse: 'A', quantity: 8 }, to: { ...applied, warehouse: 'B', quantity: 4 } });
  await render(<StockMoves />, '/stock-moves/transfer'); await submit();
  expect(stockApi.transfer).toHaveBeenCalledWith({ sku: 'SKU-1', fromWarehouseCode: 'A', toWarehouseCode: 'B', quantity: 2, note: 'note' }); expect(text()).toContain('8'); expect(text()).toContain('4');
});
const resource = <ResourcePage<{id:string;status:string}> title="Products" subtitle="Records" endpoint="/products" fields={[{ name: 'sku', label: 'SKU', required: true }, { name: 'name', label: 'Name', required: true }, { name:'description', label:'Description', type:'textarea' }]} columns={[]} createLabel="Add product" searchLabel="Search" searchPlaceholder="Search" />;
it('resource action URL validates inline, omits optional blanks, locks clicks and navigates after an actual id', async () => {
  const write = deferred<{id:string;status:string}>(); vi.mocked(api.post).mockReturnValueOnce(write.promise);
  await render(resource, '/products/new'); await submit(); expect(api.post).not.toHaveBeenCalled(); expect(document.activeElement?.getAttribute('name')).toBe('sku');
  await input('sku','SKU-2'); await input('name','Product'); await submit(2); expect(api.post).toHaveBeenCalledWith('/products', { sku:'SKU-2',name:'Product' }); expect(api.post).toHaveBeenCalledOnce();
  expect(container.querySelector('output')!.textContent).toBe('/products/new');
  await act(async () => write.resolve({id:'saved-product',status:'active'})); expect(container.querySelector('output')!.textContent).toBe('/products'); expect(container.querySelector('a[href="/products/saved-product"]')).not.toBeNull();
});
it('resource malformed success retains the draft and shows unconfirmed recovery instead of success', async () => {
  vi.mocked(api.post).mockResolvedValueOnce({}); await render(resource,'/products/new'); await input('sku','SKU'); await input('name','Product'); await submit();
  expect(container.querySelector('output')!.textContent).toBe('/products/new'); expect(text()).toContain('Save outcome is unconfirmed'); expect(container.querySelector<HTMLInputElement>('[name="sku"]')!.value).toBe('SKU');
});
it('staff create requires account and temporary password, with no password in session storage', async () => {
  const write = deferred<Awaited<ReturnType<typeof staffApi.create>>>(); vi.mocked(staffApi.create).mockReturnValueOnce(write.promise);
  await render(<StaffAccounts />,'/settings/staff/new'); await input('email','person@example.com'); await submit(2);
  expect(staffApi.create).toHaveBeenCalledOnce(); expect(text()).not.toContain('one-time-password');
  await act(async () => write.resolve({ account: {id:'new-staff',email:'person@example.com',role:'marketing',status:'active',name:null,createdAt:''},temporaryPassword:'one-time-password' }));
  expect(container.querySelector('output')!.textContent).toBe('/settings/staff'); expect(text()).toContain('one-time-password'); expect(JSON.stringify(sessionStorage)).not.toContain('one-time-password');
});
it('staff malformed response never presents a password handover or a saved account', async () => {
  vi.mocked(staffApi.create).mockResolvedValueOnce({ account: { id:'new-staff', email:'person@example.com' } } as never);
  await render(<StaffAccounts />,'/settings/staff/new'); await input('email','person@example.com'); await submit();
  expect(container.querySelector('output')!.textContent).toBe('/settings/staff/new'); expect(text()).toContain('Save outcome is unconfirmed');
});
it('staff counts disappear during refresh/failure and return only from the successful authoritative list', async () => {
  const account = { id:'staff-other',email:'other@example.invalid',role:'marketing',status:'active',name:null,createdAt:'2026-10-09T03:00:00Z',mustChangePassword:true } as const;
  const refresh = deferred<Awaited<ReturnType<typeof staffApi.list>>>();
  vi.mocked(staffApi.list).mockResolvedValueOnce([account]).mockReturnValueOnce(refresh.promise).mockResolvedValueOnce([account,{...account,id:'staff-disabled',status:'disabled'}]);
  await render(<StaffAccounts />,'/settings/staff'); expect(text()).toContain('1 active · 1 total');
  await act(async()=>button('Refresh').click()); expect(text()).not.toContain('1 active · 1 total');
  await act(async()=>refresh.reject(new Error('Account read failed'))); expect(text()).not.toContain('1 active · 1 total'); expect(text()).not.toContain('0 active · 0 total');
  await act(async()=>button('Try again').click()); expect(text()).toContain('1 active · 2 total');
});
it('integration secret reaches only the API, is excluded from drafts and clears after browser navigation', async () => {
  vi.mocked(api.get).mockResolvedValue([]); vi.mocked(api.post).mockRejectedValueOnce(Object.assign(new Error('Invalid slug'), {status:422}));
  await render(<Integrations />,'/integrations/new'); await input('name','Shop'); await input('signingSecret','private-fixture-secret'); await submit();
  expect(api.post).toHaveBeenCalledWith('/integrations', {name:'Shop',type:'example',signingSecret:'private-fixture-secret'});
  expect(JSON.stringify(sessionStorage)).not.toContain('private-fixture-secret');
  await act(async () => root.render(null)); await render(<Integrations />,'/integrations/new'); expect(container.querySelector<HTMLInputElement>('[name="signingSecret"]')!.value).toBe(''); expect(text()).toContain('Signing secrets are excluded');
});

it('a remounted action cannot reconcile or resubmit while the original known promise is still in flight', async () => {
  stockDraft(); const write=deferred<typeof applied>(); vi.mocked(stockApi.adjust).mockReturnValueOnce(write.promise);
  await render(<StockMoves/>,'/stock-moves/receive'); await submit(); await act(async()=>root.render(null));
  await render(<StockMoves/>,'/stock-moves/receive'); expect(button('Check current data').disabled).toBe(true);
  await act(async()=>button('Check current data').click()); await submit(); expect(inventoryOverviewApi.get).not.toHaveBeenCalled(); expect(stockApi.adjust).toHaveBeenCalledOnce();
  await act(async()=>write.resolve(applied)); expect(button('Check current data').disabled).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('[type=submit]')!.disabled).toBe(true); expect(text()).toContain('Save outcome is unconfirmed');
});

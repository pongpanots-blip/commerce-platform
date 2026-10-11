// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setUiLocale, confirmLeaveIfDirty, uiText } from '@cp/ui';
import { joshAdmin, joshCustomerApi, joshProductApi, joshOrderApi } from '../../lib/api';
import { CsDesk, SampleRequestsRedirect, sampleDecisions, orderReceipt, mergeReceipt } from './CsDesk';

vi.mock('../../lib/api', () => ({ session: { claims: () => ({ sub: 'fixture' }) }, joshAdmin: { get: vi.fn(), call: vi.fn() }, joshCustomerApi: { list: vi.fn(), detail: vi.fn() }, joshProductApi: { list: vi.fn() }, joshOrderApi: { list: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
HTMLDialogElement.prototype.close ??= function () { this.open = false; };
let root: Root;
let container: HTMLDivElement;
let rows: Record<string, unknown>[];
function Location() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output>{location.pathname + location.search + location.hash}</output><button onClick={() => navigate(-1)}>Back test</button><button onClick={() => navigate(1)}>Forward test</button></>;
}
const text = () => container.textContent ?? '';
const button = (label: string) => [...container.querySelectorAll('button')].find(node => node.textContent === label)!;
async function render(path: string, role = 'cs') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Location /><Routes>
    <Route path="/j/cs/sample-requests" element={<SampleRequestsRedirect role={role} />} />
    <Route path="/cs/samples/:id/:decision" element={<CsDesk role={role} />} />
    <Route path="/cs/*" element={<CsDesk role={role} />} />
  </Routes></MemoryRouter>));
}
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); setUiLocale('en');
  rows = [{ id: 'request-1', sku: 'SKU-1', quantity: 2, status: 'pending', company_name: 'Customer one' }];
  vi.mocked(joshAdmin.get).mockImplementation(async () => ({ data: { items: rows.map(row => ({ ...row })) } }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setUiLocale('th'); vi.restoreAllMocks(); });

it('preserves legacy pending fulfillment and does not offer completed decisions again', () => {
  expect(sampleDecisions('pending')).toEqual(['approved', 'rejected', 'fulfilled']);
  expect(sampleDecisions('approved')).toEqual(['fulfilled']);
  for (const state of ['rejected', 'fulfilled', 'unknown']) expect(sampleDecisions(state)).toEqual([]);
});

it('redirects the old samples deep link preserving filters and hash', async () => {
  await render('/j/cs/sample-requests?status=pending&source=saved#requests');
  expect(container.querySelector('output')!.textContent).toBe('/cs/samples?status=pending&source=saved#requests');
  expect(joshAdmin.get).toHaveBeenCalledWith('/cs-admin/sample-requests', { status: 'pending' });
  expect(text()).toContain('Customer one');
});

it('uses task URLs and browser history for customer-service navigation', async () => {
  await render('/cs');
  expect(joshAdmin.get).not.toHaveBeenCalled();
  expect(container.querySelector('a[href="/cs/accounts/merge"]')).toBeNull();
  await act(async () => button(uiText('คำขอสินค้าตัวอย่าง')).click());
  expect(container.querySelector('output')!.textContent).toBe('/cs/samples');
  await act(async () => button('Back test').click());
  expect(container.querySelector('output')!.textContent).toBe('/cs/orders/new');
  await act(async () => button('Forward test').click());
  expect(text()).toContain('Customer one');
});

it('blocks direct merge access and makes no service calls for a denied role', async () => {
  await render('/cs/accounts/merge');
  expect(text()).toContain('You do not have permission');
  expect(joshAdmin.get).not.toHaveBeenCalled(); expect(joshAdmin.call).not.toHaveBeenCalled();
});

it('shows loading, failure and retry rather than a false empty result', async () => {
  const loading = deferred<unknown>(); vi.mocked(joshAdmin.get).mockReturnValueOnce(loading.promise);
  await render('/cs/samples');
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(text()).not.toContain('No requests');
  await act(async () => loading.reject(new Error('403 forbidden')));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(text()).not.toContain('No requests');
  await act(async () => button('Try again').click());
  expect(text()).toContain('Customer one');
});

it('reports malformed service responses as errors, and provides a useful empty state', async () => {
  vi.mocked(joshAdmin.get).mockResolvedValueOnce({ unexpected: 'shape' });
  await render('/cs/samples?status=fulfilled');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  rows = [];
  await act(async () => button('Try again').click());
  expect(text()).toContain('No requests');
  expect(button('Clear Filters')).toBeTruthy();
});

it('waits for persistence, locks duplicate submit, reloads authoritative status, and prevents replay', async () => {
  const patch = deferred<unknown>(); vi.mocked(joshAdmin.call).mockReturnValueOnce(patch.promise);
  await render('/cs/samples/request-1/approved?status=pending');
  await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  const form = container.querySelector('form')!;
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(joshAdmin.call).toHaveBeenCalledTimes(1);
  expect(joshAdmin.call).toHaveBeenCalledWith('PATCH', '/cs-admin/sample-requests/request-1', { status: 'approved' });
  expect(text()).not.toContain('Request status saved');
  rows[0].status = 'approved';
  await act(async () => patch.resolve({ data: rows[0] }));
  expect(text()).toContain('Request status saved');
  expect(container.querySelector('form')).toBeNull();
  expect(text()).toContain('Approve');
  await act(async () => root.render(null));
  await render('/cs/samples/request-1/approved');
  expect(text()).toContain('This request has changed status');
  expect(container.querySelector('form')).toBeNull();
});

it('keeps failed reviews editable and protects unsaved notes until persistence succeeds', async () => {
  vi.mocked(joshAdmin.call).mockRejectedValueOnce(Object.assign(new Error('Not saved'), { status: 409 }));
  await render('/cs/samples/request-1/rejected');
  const input = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Please retry');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
  });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(text()).not.toContain('Request status saved');
  expect(container.querySelector('textarea')!.value).toBe('Please retry');
  let leave!: Promise<boolean>;
  await act(async () => { leave = confirmLeaveIfDirty(); });
  expect(container.querySelector('dialog[open]')).not.toBeNull();
  await act(async () => (container.querySelector('dialog button') as HTMLButtonElement).click());
  await expect(leave).resolves.toBe(false);
  vi.mocked(joshAdmin.call).mockImplementationOnce(async () => { rows[0].status = 'rejected'; rows[0].cs_note = 'Please retry'; return { data: rows[0] }; });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(text()).toContain('Request status saved');
  await expect(confirmLeaveIfDirty()).resolves.toBe(true);
});

it('restores a note after interrupted navigation without claiming it was saved', async () => {
  sessionStorage.setItem('cp-sample-note:fixture:request-1:approved', 'Draft note');
  await render('/cs/samples/request-1/approved');
  expect(container.querySelector('textarea')!.value).toBe('Draft note');
  expect(text()).not.toContain('Request status saved');
});

it('treats an explicit business failure in HTTP success as a failed save', async () => {
  vi.mocked(joshAdmin.call).mockResolvedValueOnce({ status: false, message: 'Request already changed' });
  await render('/cs/samples/request-1/approved');
  await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(text()).not.toContain('Request status saved');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector('form')).not.toBeNull();
});

it('does not enable an invalid action or a missing record', async () => {
  await render('/cs/samples/request-1/invalid');
  expect(container.querySelector('form')).toBeNull();
  await act(async () => root.render(null));
  await render('/cs/samples/missing/approved');
  expect(text()).toContain('Request not found');
  expect(joshAdmin.call).not.toHaveBeenCalled();
});

it('validates distinct merge IDs, preserves the confirmation boundary and reports success after persistence', async () => {
  const primary = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const duplicate = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const set = async (first: string, second: string) => {
    await act(async () => [...container.querySelectorAll('form input')].forEach((input, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, index ? second : first);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }));
  };
  const submit = async () => { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };
  await render('/cs/accounts/merge', 'admin');
  await set(primary, primary.toUpperCase()); await submit();
  expect(joshAdmin.call).not.toHaveBeenCalled();
  await set(primary, duplicate);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); await submit();
  expect(joshAdmin.call).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  const request = deferred<unknown>(); vi.mocked(joshAdmin.call).mockReturnValueOnce(request.promise);
  await submit();
  expect(joshAdmin.call).toHaveBeenCalledWith('POST', '/cs-admin/accounts/merge', { primary_user_id: primary, duplicate_user_id: duplicate });
  expect((container.querySelector('form input') as HTMLInputElement).disabled).toBe(true);
  expect(text()).not.toContain('Merged');
  await act(async () => request.resolve({ merged: true }));
  expect(container.querySelector('form input')!.getAttribute('value')).toBe('');
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});

it.each([null, {}, {data:{}}, {data:{orderIds:[]}}, {status:false,data:{orderIds:['bad']}}])('does not confirm a malformed order receipt %j', value => {
  expect(() => orderReceipt(value)).toThrow();
});
it('accepts the documented orderIds receipt and requires explicit merge completion', () => {
  expect(orderReceipt({data:{orderIds:['persisted-order'],orderNumbers:['1001']}}).orderIds).toEqual(['persisted-order']);
  expect(() => mergeReceipt({})).toThrow(); expect(() => mergeReceipt({data:{merged:false}})).toThrow();
  expect(mergeReceipt({data:{merged:true}})).toEqual({merged:true});
});

it('a status changed by another operator cannot confirm persistence of this review note', async () => {
  await render('/cs/samples/request-1/approved');
  await act(async()=>{
    const note=container.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(note,'My note');note.dispatchEvent(new Event('input',{bubbles:true}));
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
  });
  vi.mocked(joshAdmin.call).mockImplementationOnce(async()=>{rows[0].status='approved';rows[0].cs_note='Someone else';return {data:rows[0]};});
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(text()).not.toContain('Request status saved');expect(text()).toContain('Save outcome is unconfirmed');
  expect(container.querySelector('textarea')!.value).toBe('My note');
});

it('on-behalf order survives interruption and never replays while its original write is pending', async () => {
  const company={id:'company-1',name:'Customer one',users:[{id:'user-1',is_active:true,first_name:'Buyer'}],branches:[{id:'branch-1',name:'Branch'}]};
  vi.mocked(joshCustomerApi.list).mockResolvedValue({items:[company],total:1});vi.mocked(joshCustomerApi.detail).mockResolvedValue(company);
  vi.mocked(joshProductApi.list).mockResolvedValue({items:[{product_inventory_id:'product-1',product_inventory_sku:'SKU-1',name_th:'Product',selling_unit_price:10}],total:1});
  sessionStorage.setItem('cp-action-draft:fixture:cs:order',JSON.stringify({phase:'editing',values:{who:JSON.stringify({company:{id:company.id,name:company.name},userId:'user-1',branchId:'branch-1'}),items:JSON.stringify([{id:'product-1',sku:'SKU-1',name:'Product',quantity:2}]),payment_method:'credit',coupon_code:'',delivery_date:''}}));
  const write=deferred<unknown>();vi.mocked(joshAdmin.call).mockImplementation(async(_method,path)=>path.endsWith('/quote')?{data:{total_inc_vat:20}}:write.promise);
  vi.spyOn(window,'confirm').mockReturnValue(true);
  await render('/cs/orders/new');await act(async()=>button(uiText('คิดราคา')).click());
  await act(async()=>[...container.querySelectorAll('form')].at(-1)!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(joshAdmin.call).toHaveBeenCalledWith('POST','/cs-admin/orders/place-on-behalf',{user_id:'user-1',branch_id:'branch-1',items:[{product_inventory_id:'product-1',quantity:2}],payment_method:'credit'});
  await act(async()=>root.render(null));await render('/cs/orders/new');
  expect(button('Check current data').disabled).toBe(true);expect(joshAdmin.call).toHaveBeenCalledTimes(2);
  await act(async()=>write.resolve({data:{orderIds:['saved-order']}}));
  expect(text()).not.toContain('Order created');expect(button('Check current data').disabled).toBe(false);
  expect(JSON.parse(sessionStorage.getItem('cp-action-draft:fixture:cs:order')!).phase).toBe('unknown');
});

it('approve and reject share a request lock and a sibling decision requires a fresh status read', async () => {
  const write=deferred<unknown>();vi.mocked(joshAdmin.call).mockReturnValueOnce(write.promise);
  await render('/cs/samples/request-1/approved');await act(async()=>container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await act(async()=>root.render(null));await render('/cs/samples/request-1/rejected');
  expect(button('Check current data').disabled).toBe(true);
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(joshAdmin.call).toHaveBeenCalledOnce();rows[0].status='approved';
  await act(async()=>write.resolve({data:rows[0]}));
  expect(text()).toContain('Save outcome is unconfirmed');expect(container.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
  await act(async()=>button('Check current data').click());
  expect(text()).toContain('This request has changed status');expect(container.querySelector('form')).toBeNull();
});

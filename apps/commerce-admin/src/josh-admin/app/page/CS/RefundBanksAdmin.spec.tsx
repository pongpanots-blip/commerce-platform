// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRefundBank, listRefundBanks, updateRefundBank, type RefundBankAdmin } from '@josh/shared-api';
import RefundBanksAdmin from './RefundBanksAdmin';

vi.mock('@josh/shared-api', () => ({
  listRefundBanks: vi.fn(),
  createRefundBank: vi.fn(async () => ({ data: { data: {} } })),
  updateRefundBank: vi.fn(async () => ({ data: { data: {} } })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCB: RefundBankAdmin = {
  code: 'SCB', nameTh: 'ธนาคารไทยพาณิชย์', nameEn: 'Siam Commercial Bank', accountDigits: [10],
  logoUrl: 'https://cdn/scb.png', sortOrder: 10, isActive: true,
};
const GSB: RefundBankAdmin = {
  code: 'GSB', nameTh: 'ธนาคารออมสิน', nameEn: 'Government Savings Bank', accountDigits: [12, 15],
  logoUrl: null, sortOrder: 80, isActive: false,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(listRefundBanks).mockResolvedValue({ data: { data: [SCB, GSB] } } as never);
  vi.spyOn(window, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const render = async () => {
  await act(async () => root.render(
    <MemoryRouter>
      <RefundBanksAdmin />
    </MemoryRouter>,
  ));
};
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const field = (name: string) => host.querySelector(`[name="${name}"]`) as HTMLInputElement;
/** React listens for `input` and reads the native value. */
async function type(name: string, value: string) {
  const el = field(name);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function pick(name: string, file: File) {
  const el = field(name);
  Object.defineProperty(el, 'files', { value: [file], configurable: true });
  await act(async () => el.dispatchEvent(new Event('change', { bubbles: true })));
}

it('lists every bank with its logo, both names, account lengths and status', async () => {
  await render();
  expect(host.querySelector('img[src="https://cdn/scb.png"]')).not.toBeNull();
  expect(host.textContent).toContain('Siam Commercial Bank');
  expect(host.textContent).toContain('ธนาคารออมสิน');
  expect(host.textContent).toContain('12, 15');
  expect(host.textContent).toContain('ปิดใช้งาน');
});

it('adds a bank: code upper-cased, lengths parsed, logo sent; save waits for the required fields', async () => {
  await render();
  await act(async () => button('เพิ่มธนาคาร')?.click());
  expect((button('บันทึก') as HTMLButtonElement).disabled).toBe(true);
  await type('code', 'uob');
  await type('nameTh', 'ธนาคารยูโอบี');
  await type('nameEn', 'UOB');
  await type('accountDigits', '10, 12');
  await type('sortOrder', '90');
  const logo = new File(['x'], 'uob.png', { type: 'image/png' });
  await pick('logo', logo);
  expect((button('บันทึก') as HTMLButtonElement).disabled).toBe(false);
  await act(async () => button('บันทึก')?.click());
  expect(createRefundBank).toHaveBeenCalledWith(
    { code: 'UOB', nameTh: 'ธนาคารยูโอบี', nameEn: 'UOB', accountDigits: [10, 12], sortOrder: 90, isActive: true, logo },
    'th',
  );
  expect(listRefundBanks).toHaveBeenCalledTimes(2);
});

it('a bad code or account length keeps save disabled', async () => {
  await render();
  await act(async () => button('เพิ่มธนาคาร')?.click());
  await type('code', 'U O B');
  await type('nameTh', 'x');
  await type('nameEn', 'x');
  await type('accountDigits', '10');
  expect((button('บันทึก') as HTMLButtonElement).disabled).toBe(true);
  await type('code', 'UOB');
  await type('accountDigits', '3');
  expect((button('บันทึก') as HTMLButtonElement).disabled).toBe(true);
});

it('edits a bank: code is fixed, deactivating and removing the logo are sent', async () => {
  await render();
  const edit = [...host.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'แก้ไข');
  await act(async () => edit[0].click());
  expect(field('code').disabled).toBe(true);
  expect(field('nameEn').value).toBe('Siam Commercial Bank');
  await act(async () => field('isActive').click());
  await act(async () => field('removeLogo').click());
  await act(async () => button('บันทึก')?.click());
  expect(updateRefundBank).toHaveBeenCalledWith(
    'SCB',
    { nameTh: 'ธนาคารไทยพาณิชย์', nameEn: 'Siam Commercial Bank', accountDigits: [10], sortOrder: 10, isActive: false, removeLogo: true, logo: null },
    'th',
  );
});

it('shows josh’s message when saving fails and keeps the form open', async () => {
  vi.mocked(createRefundBank).mockRejectedValueOnce({ response: { data: { message: 'มีธนาคารรหัส SCB อยู่แล้ว' } } });
  await render();
  await act(async () => button('เพิ่มธนาคาร')?.click());
  await type('code', 'SCB');
  await type('nameTh', 'x');
  await type('nameEn', 'x');
  await type('accountDigits', '10');
  await act(async () => button('บันทึก')?.click());
  expect(window.alert).toHaveBeenCalledWith('มีธนาคารรหัส SCB อยู่แล้ว');
  expect(button('บันทึก')).toBeDefined();
});

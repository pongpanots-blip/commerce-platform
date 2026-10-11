// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  approveRefundRequest,
  getRefundRequest,
  listRefundRequests,
  markRefundTransferred,
  type RefundRequestDetail,
} from '@josh/shared-api';
import RefundRequestsAdmin from './RefundRequestsAdmin';

vi.mock('@josh/shared-api', () => ({
  listRefundRequests: vi.fn(),
  getRefundRequest: vi.fn(),
  approveRefundRequest: vi.fn(async () => ({ data: { data: {} } })),
  rejectRefundRequest: vi.fn(async () => ({ data: { data: {} } })),
  requestRefundChanges: vi.fn(async () => ({ data: { data: {} } })),
  retryRefundRequest: vi.fn(async () => ({ data: { data: {} } })),
  resolveRefundRequest: vi.fn(async () => ({ data: { data: {} } })),
  markRefundTransferred: vi.fn(async () => ({ data: { data: {} } })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const detail = (over: Partial<RefundRequestDetail> = {}): RefundRequestDetail => ({
  refundRequestId: 'rr1',
  refundNumber: 'RF2026000001',
  orderId: 'o1',
  orderNumber: 'SO1',
  source: 'return',
  status: 'under_review',
  method: 'card',
  amountIncVat: 300,
  cashAmountIncVat: null,
  createdAt: '2026-10-10T03:00:00.000Z',
  approvedAt: null,
  gatewayStatus: null,
  reason: 'ของเสีย',
  creditAmountIncVat: null,
  items: [{ orderItemId: 'a', productName: 'แซลมอน', sku: 'SKU1', quantity: 1, amountIncVat: 300 }],
  evidenceUrls: ['https://signed/e1.jpg'],
  cashReason: 'other',
  cashReasonNote: null,
  bankAccount: null,
  policyVersion: null,
  policyAcceptedAt: null,
  refundTo: null,
  gatewayAction: null,
  gatewayResponse: null,
  transferSlipUrl: null,
  transferredAmount: null,
  transferredAt: null,
  changesRequestedReason: null,
  rejectReason: null,
  adminNote: null,
  approvalPreview: null,
  ...over,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function openWith(d: RefundRequestDetail) {
  vi.mocked(listRefundRequests).mockResolvedValue({ data: { data: { items: [d], total: 1, page: 1 } } } as never);
  vi.mocked(getRefundRequest).mockResolvedValue({ data: { data: d } } as never);
  await act(async () => root.render(
      <MemoryRouter>
        <RefundRequestsAdmin />
      </MemoryRouter>,
    ));
  const open = [...host.querySelectorAll('button')].find((b) => b.textContent === 'ดู');
  await act(async () => open?.click());
}

const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

it('approves a request under review after confirming', async () => {
  await openWith(detail());
  await act(async () => button('อนุมัติ')?.click());
  expect(window.confirm).toHaveBeenCalled();
  expect(approveRefundRequest).toHaveBeenCalledWith('rr1', undefined);
});

it('a weight-diff request cannot be rejected', async () => {
  await openWith(detail({ source: 'weight_diff', reason: 'weight_adjustment', items: [] }));
  expect(button('อนุมัติ')).toBeDefined();
  expect(button('ปฏิเสธ')).toBeUndefined();
});

it('records a bank transfer only with a slip, with the cash amount prefilled', async () => {
  await openWith(
    detail({
      status: 'awaiting_transfer',
      method: 'bank_transfer',
      cashAmountIncVat: 300,
      bankAccount: { bankCode: 'SCB', bankNameTh: 'ธนาคารไทยพาณิชย์', accountNumber: '1234567890', holderName: 'บจก. เอ', bookbankUrl: null },
    }),
  );
  expect(host.textContent).toContain('1234567890');
  const save = button('บันทึกการโอน') as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  const file = host.querySelector('input[type="file"]') as HTMLInputElement;
  const slip = new File(['x'], 'slip.jpg', { type: 'image/jpeg' });
  Object.defineProperty(file, 'files', { value: [slip] });
  await act(async () => file.dispatchEvent(new Event('change', { bubbles: true })));
  expect((button('บันทึกการโอน') as HTMLButtonElement).disabled).toBe(false);
  await act(async () => button('บันทึกการโอน')?.click());
  expect(markRefundTransferred).toHaveBeenCalledWith('rr1', expect.objectContaining({ amount: 300, slip }));
});

it('an unknown KBank outcome shows the portal warning and no retry', async () => {
  await openWith(detail({ status: 'processing', gatewayStatus: 'unknown', cashAmountIncVat: 300 }));
  expect(host.textContent).toContain('KBank portal');
  expect(button('ลองใหม่')).toBeUndefined();
  expect(button('ทำเครื่องหมายว่าสำเร็จ')).toBeDefined();
});

it('REVIEW I1: a card payout stuck in pending for over 10 minutes can be resolved; a fresh one cannot', async () => {
  const old = new Date(Date.now() - 11 * 60_000).toISOString();
  await openWith(detail({ status: 'processing', gatewayStatus: 'pending', approvedAt: old, cashAmountIncVat: 300 }));
  expect(button('ทำเครื่องหมายว่าสำเร็จ')).toBeDefined();
});

it('a payout pending for a moment shows no resolve buttons', async () => {
  await openWith(detail({ status: 'processing', gatewayStatus: 'pending', approvedAt: new Date().toISOString() }));
  expect(button('ทำเครื่องหมายว่าสำเร็จ')).toBeUndefined();
});

it('REVIEW M8: the approve confirmation shows how much goes back as cash and as a Credit Note', async () => {
  await openWith(detail({ amountIncVat: 900, approvalPreview: { cashIncVat: 700, creditIncVat: 200 } }));
  await act(async () => button('อนุมัติ')?.click());
  const text = vi.mocked(window.confirm).mock.calls[0][0] as string;
  expect(text).toContain('฿700.00');
  expect(text).toContain('฿200.00');
  expect(text).toContain('Credit Note');
});

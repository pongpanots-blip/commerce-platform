// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
import {
  approveRefundRequest,
  getRefundRequest,
  listRefundRequests,
  markRefundTransferred,
  rejectRefundRequest,
  requestRefundChanges,
  resolveRefundRequest,
  retryRefundRequest,
  type RefundRequestDetail,
  type RefundRequestRow,
  type RefundRequestStatus,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { Button as CpButton, Chip, KeyValueGrid, type Tone, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';

/** Queue tabs → josh statuses (the list API filters one status at a time; multi-status tabs merge). */
const TABS: { key: string; label: () => string; statuses: (RefundRequestStatus | undefined)[] }[] = [
  { key: 'review', label: () => __uiText('รอตรวจ'), statuses: ['under_review'] },
  { key: 'transfer', label: () => __uiText('รอโอน'), statuses: ['awaiting_transfer'] },
  { key: 'attention', label: () => __uiText('ต้องดูแล'), statuses: ['failed', 'processing'] },
  { key: 'customer', label: () => __uiText('รอลูกค้า'), statuses: ['awaiting_method', 'changes_requested'] },
  { key: 'done', label: () => __uiText('เสร็จ'), statuses: ['completed'] },
  { key: 'all', label: () => __uiText('ทั้งหมด'), statuses: [undefined] },
];

const SOURCE_LABEL: Record<string, () => string> = {
  return: () => __uiText('คืนสินค้า'),
  weight_diff: () => __uiText('ส่วนต่างน้ำหนัก'),
};

const METHOD_LABEL: Record<string, () => string> = {
  credit: () => __uiText('เครดิต'),
  card: () => __uiText('คืนเข้าบัตร'),
  bank_transfer: () => __uiText('โอนเข้าบัญชี'),
};

const CASH_REASON_LABEL: Record<string, () => string> = {
  business_needs_cash: () => __uiText('ธุรกิจต้องการเงินสด'),
  no_reorder_soon: () => __uiText('ยังไม่มีแผนสั่งซื้อเร็ว ๆ นี้'),
  accounting_requires_bank: () => __uiText('ฝ่ายบัญชีต้องการรับคืนเข้าบัญชี'),
  prefer_not_to_say: () => __uiText('ไม่ระบุ'),
  other: () => __uiText('อื่น ๆ'),
};

const STATUS_LABEL: Record<string, () => string> = {
  awaiting_method: () => __uiText('รอลูกค้าเลือกวิธีคืน'),
  under_review: () => __uiText('รอตรวจ'),
  changes_requested: () => __uiText('ขอข้อมูลเพิ่มจากลูกค้า'),
  processing: () => __uiText('กำลังคืนเงิน'),
  awaiting_transfer: () => __uiText('รอโอน'),
  completed: () => __uiText('คืนเงินแล้ว'),
  rejected: () => __uiText('ปฏิเสธแล้ว'),
  failed: () => __uiText('คืนเงินไม่สำเร็จ'),
  cancelled: () => __uiText('ยกเลิก'),
};

const STATUS_TONE: Record<string, Tone> = {
  awaiting_method: 'warn',
  under_review: 'warn',
  changes_requested: 'warn',
  processing: 'info',
  awaiting_transfer: 'info',
  completed: 'ok',
  rejected: 'danger',
  failed: 'danger',
  cancelled: 'muted',
};

const GATEWAY_ACTION_LABEL: Record<string, () => string> = {
  void: () => __uiText('ยกเลิกรายการชำระ'),
  refund: () => __uiText('คืนเงินเข้าบัตร'),
};

const GATEWAY_STATUS_LABEL: Record<string, () => string> = {
  pending: () => __uiText('รอผล'),
  success: () => __uiText('สำเร็จ'),
  failed: () => __uiText('ไม่สำเร็จ'),
  unknown: () => __uiText('ไม่ทราบผล'),
};

function RefundStatusChip({ status }: { status: string }) {
  return (
    <Chip tone={STATUS_TONE[status] ?? 'muted'} statusCode={status} dot>
      {STATUS_LABEL[status]?.() ?? status}
    </Chip>
  );
}

/** josh STUCK_PAYOUT_MS — a card payout still pending this long after approval may be resolved by hand. */
const STUCK_PAYOUT_MS = 10 * 60_000;

function money(n: number | null | undefined) {
  return n == null ? '—' : `฿${Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(v: string | null | undefined) {
  return v ? new Date(v).toLocaleString(__dateLocale() === 'th' ? 'th-TH' : 'en-GB') : '—';
}

function errorMessage(e: unknown): string {
  const r = e as { response?: { data?: { message?: string } }; message?: string };
  return r?.response?.data?.message ?? r?.message ?? __uiText('ทำรายการไม่สำเร็จ');
}

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function RefundRequestsAdmin() {
  __useUiLocale();
  const [tab, setTab] = useState(TABS[0].key);
  const [rows, setRows] = useState<RefundRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<RefundRequestDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferAt, setTransferAt] = useState(nowLocal());
  const [slip, setSlip] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statuses = TABS.find((t) => t.key === tab)?.statuses ?? [undefined];
      const pages = await Promise.all(statuses.map((status) => listRefundRequests({ status })));
      setRows(pages.flatMap((p) => p.data?.data?.items ?? []));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    try {
      const res = await getRefundRequest(id);
      const d = res.data?.data ?? null;
      setDetail(d);
      setTransferAmount(d?.cashAmountIncVat != null ? String(d.cashAmountIncVat) : '');
      setTransferAt(nowLocal());
      setSlip(null);
    } catch (e) {
      alert(errorMessage(e));
    }
  };

  const run = async (action: () => Promise<unknown>) => {
    if (!detail) return;
    setBusy(true);
    try {
      await action();
      await openDetail(detail.refundRequestId);
      await load();
    } catch (e) {
      alert(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const askReason = (title: string) => {
    const reason = window.prompt(title)?.trim();
    return reason ? reason : null;
  };

  const columns: TableColumn<RefundRequestRow>[] = [
    { key: 'refundNumber', label: __uiText('เลขคำขอ'), render: (v) => <span className="font-mono">{String(v)}</span> },
    { key: 'orderNumber', label: __uiText('ออเดอร์'), render: (v) => (v ? <span className="font-mono">{String(v)}</span> : '—') },
    { key: 'source', label: __uiText('ประเภท'), render: (v) => SOURCE_LABEL[String(v)]?.() ?? String(v) },
    { key: 'method', label: __uiText('วิธีคืน'), render: (v) => (v ? METHOD_LABEL[String(v)]?.() ?? String(v) : '—') },
    { key: 'amountIncVat', label: __uiText('ยอด (รวม VAT)'), align: 'right', render: (v) => <span className="tabular-nums">{money(Number(v))}</span> },
    { key: 'status', label: __uiText('สถานะ'), render: (v) => <RefundStatusChip status={String(v)} /> },
    { key: 'createdAt', label: __uiText('แจ้งเมื่อ'), render: (v) => when(v as string | null) },
    {
      key: 'refundRequestId',
      label: '',
      render: (id) => (
        <CpButton size="sm" variant="ghost" onClick={() => void openDetail(String(id))}>
          {__uiText('ดู')}
        </CpButton>
      ),
    },
  ];

  const d = detail;
  // Same rule as josh's resolve: KBank never answered, or the payout has sat `pending` for over 10 minutes.
  const stuckPending =
    d?.status === 'processing' &&
    d.gatewayStatus === 'pending' &&
    !!d.approvedAt &&
    Date.now() - new Date(d.approvedAt).getTime() > STUCK_PAYOUT_MS;
  const unknownGateway = (d?.status === 'processing' && d.gatewayStatus === 'unknown') || stuckPending;
  const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50';

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader
        title={__uiText('คำขอคืนเงิน')}
        subtitle={__uiText('ตรวจหลักฐาน อนุมัติ และโอนเงินคืนให้ลูกค้า')}
      >
        <CpButton icon="refresh" onClick={() => void load()}>{__uiText('รีเฟรช')}</CpButton>
      </AdminListHeader>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${btn} border ${tab === t.key ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label()}
          </button>
        ))}
      </div>

      <Table
        columns={columns}
        data={rows}
        idKey="refundRequestId"
        currentPage={1}
        totalPages={1}
        onPageChange={() => undefined}
        loading={loading}
        emptyTitle={__uiText('ไม่มีคำขอคืนเงินในแท็บนี้')}
        emptyDescription={__uiText('ลองเปิดแท็บอื่น หรือกดรีเฟรช')}
      />

      {d && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-mono text-lg font-semibold text-gray-800">{d.refundNumber}</h2>
                  <RefundStatusChip status={d.status} />
                </div>
                <p className="text-sm text-gray-500">
                  {SOURCE_LABEL[d.source]?.()} · {__uiText('ออเดอร์')} <span className="font-mono">{d.orderNumber ?? d.orderId}</span>
                </p>
              </div>
              <button type="button" className="text-sm text-gray-500 hover:text-gray-800" onClick={() => setDetail(null)}>
                {__uiText('ปิด')}
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-700">
              <KeyValueGrid
                cols={3}
                items={[
                  { label: 'ยอดคืน', value: <b className="tabular-nums">{money(d.amountIncVat)}</b> },
                  { label: 'วิธีคืน', value: d.method ? METHOD_LABEL[d.method]?.() : __uiText('ลูกค้ายังไม่เลือก') },
                  { label: 'แจ้งเมื่อ', value: when(d.createdAt) },
                  { label: 'เงินสด', value: money(d.cashAmountIncVat) },
                  { label: 'เครดิต', value: money(d.creditAmountIncVat) },
                  { label: 'คืนไปที่', value: d.refundTo },
                ]}
              />

              {d.source === 'return' && (
                <section>
                  <p className="mb-1 font-medium text-gray-800">{__uiText('เหตุผล')}: {d.reason}</p>
                  <ul className="divide-y divide-gray-50">
                    {d.items.map((i) => (
                      <li key={i.orderItemId} className="flex justify-between py-1">
                        <span>{i.productName} {i.sku ? `(${i.sku})` : ''} × {i.quantity}</span>
                        <span>{money(i.amountIncVat)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {d.evidenceUrls.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={__uiText('หลักฐาน')} className="h-24 w-24 rounded border object-cover" />
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {d.cashReason && (
                <p>
                  {__uiText('เหตุผลที่ขอเป็นเงิน')}: {CASH_REASON_LABEL[d.cashReason]?.() ?? d.cashReason}
                  {d.cashReasonNote ? ` — ${d.cashReasonNote}` : ''}
                </p>
              )}

              {d.bankAccount && (
                <section className="rounded-lg border border-gray-200 p-3">
                  <p className="mb-1 font-medium text-gray-800">{__uiText('บัญชีรับเงินคืน')}</p>
                  <p>{d.bankAccount.bankNameTh}</p>
                  <p className="flex items-center gap-2">
                    <span className="font-mono text-base">{d.bankAccount.accountNumber ?? __uiText('ถอดรหัสไม่ได้')}</span>
                    {d.bankAccount.accountNumber && (
                      <button
                        type="button"
                        className="text-xs text-blue-600 hover:underline"
                        onClick={() => void navigator.clipboard?.writeText(d.bankAccount?.accountNumber ?? '')}
                      >
                        {__uiText('คัดลอก')}
                      </button>
                    )}
                  </p>
                  <p>{__uiText('ชื่อบัญชี')}: {d.bankAccount.holderName}</p>
                  <p className="text-xs text-gray-500">
                    {__uiText('ยอมรับเงื่อนไข')} {d.policyVersion ?? '—'} · {when(d.policyAcceptedAt)}
                  </p>
                  {d.bankAccount.bookbankUrl && (
                    <a href={d.bankAccount.bookbankUrl} target="_blank" rel="noreferrer">
                      <img src={d.bankAccount.bookbankUrl} alt={__uiText('สมุดบัญชี')} className="mt-2 max-h-56 rounded border" />
                    </a>
                  )}
                </section>
              )}

              {d.gatewayStatus && (
                <p>
                  {__uiText('ผลจาก KBank')}: {d.gatewayAction ? GATEWAY_ACTION_LABEL[d.gatewayAction]?.() ?? d.gatewayAction : '—'} · {GATEWAY_STATUS_LABEL[d.gatewayStatus]?.() ?? d.gatewayStatus}
                </p>
              )}
              {d.transferredAt && (
                <p>
                  {__uiText('โอนแล้ว')} {money(d.transferredAmount)} · {when(d.transferredAt)}
                  {d.transferSlipUrl ? (
                    <>
                      {' · '}
                      <a href={d.transferSlipUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                        {__uiText('สลิป')}
                      </a>
                    </>
                  ) : null}
                </p>
              )}
              {d.changesRequestedReason && <p>{__uiText('ขอข้อมูลเพิ่ม')}: {d.changesRequestedReason}</p>}
              {d.rejectReason && <p>{__uiText('เหตุผลที่ปฏิเสธ')}: {d.rejectReason}</p>}
              {d.adminNote && <p>{__uiText('หมายเหตุ')}: {d.adminNote}</p>}

              {d.status === 'under_review' && (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <button
                    type="button"
                    disabled={busy}
                    className={`${btn} bg-blue-600 text-white`}
                    onClick={() => {
                      const method = d.method ? METHOD_LABEL[d.method]?.() : '';
                      const p = d.approvalPreview;
                      const split =
                        p && p.creditIncVat > 0
                          ? `\n${__uiText('เงินสด')} ${money(p.cashIncVat)} + Credit Note ${money(p.creditIncVat)}`
                          : '';
                      if (window.confirm(`${__uiText('อนุมัติคืนเงิน')} ${money(d.amountIncVat)} (${method})?${split}`)) {
                        void run(() => approveRefundRequest(d.refundRequestId, undefined));
                      }
                    }}
                  >
                    {__uiText('อนุมัติ')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={`${btn} border border-gray-300 bg-white`}
                    onClick={() => {
                      const reason = askReason(__uiText('ขอข้อมูลอะไรเพิ่มจากลูกค้า?'));
                      if (reason) void run(() => requestRefundChanges(d.refundRequestId, reason));
                    }}
                  >
                    {__uiText('ขอข้อมูลเพิ่ม')}
                  </button>
                  {d.source === 'return' && (
                    <button
                      type="button"
                      disabled={busy}
                      className={`${btn} border border-red-300 bg-white text-red-700`}
                      onClick={() => {
                        const reason = askReason(__uiText('เหตุผลที่ปฏิเสธ'));
                        if (reason) void run(() => rejectRefundRequest(d.refundRequestId, reason));
                      }}
                    >
                      {__uiText('ปฏิเสธ')}
                    </button>
                  )}
                </div>
              )}

              {d.status === 'awaiting_transfer' && (
                <div className="space-y-2 border-t pt-3">
                  <p className="font-medium text-gray-800">{__uiText('บันทึกการโอนเงินคืน')}</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs">
                      {__uiText('ยอดโอน')}
                      <input
                        type="number"
                        step="0.01"
                        className="mt-1 block w-32 rounded border px-2 py-1 text-sm"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                      />
                    </label>
                    <label className="text-xs">
                      {__uiText('วันเวลาที่โอน')}
                      <input
                        type="datetime-local"
                        className="mt-1 block rounded border px-2 py-1 text-sm"
                        value={transferAt}
                        onChange={(e) => setTransferAt(e.target.value)}
                      />
                    </label>
                    <label className="text-xs">
                      {__uiText('สลิป')}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        className="mt-1 block text-sm"
                        onChange={(e) => setSlip(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={busy || !slip || !transferAmount}
                    className={`${btn} bg-blue-600 text-white`}
                    onClick={() => {
                      if (!slip) return;
                      void run(() =>
                        markRefundTransferred(d.refundRequestId, {
                          amount: Number(transferAmount),
                          transferredAt: new Date(transferAt).toISOString(),
                          slip,
                        }),
                      );
                    }}
                  >
                    {__uiText('บันทึกการโอน')}
                  </button>
                </div>
              )}

              {d.status === 'failed' && (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <button
                    type="button"
                    disabled={busy}
                    className={`${btn} bg-blue-600 text-white`}
                    onClick={() => void run(() => retryRefundRequest(d.refundRequestId))}
                  >
                    {__uiText('ลองใหม่')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={`${btn} border border-gray-300 bg-white`}
                    onClick={() => {
                      const reason = askReason(__uiText('ให้ลูกค้าเลือกวิธีใหม่ เพราะอะไร?'));
                      if (reason) void run(() => requestRefundChanges(d.refundRequestId, reason));
                    }}
                  >
                    {__uiText('ขอข้อมูลเพิ่ม')}
                  </button>
                </div>
              )}

              {unknownGateway && (
                <div className="space-y-2 border-t pt-3">
                  <p className="rounded bg-amber-50 p-2 text-amber-800">
                    {__uiText('KBank ไม่ตอบกลับ — ตรวจใน KBank portal ก่อนว่าคืนเงินแล้วหรือยัง ห้ามสั่งคืนซ้ำถ้าไม่แน่ใจ')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className={`${btn} bg-blue-600 text-white`}
                      onClick={() => {
                        const note = askReason(__uiText('ยืนยันจาก KBank portal (หมายเหตุ)'));
                        if (note) void run(() => resolveRefundRequest(d.refundRequestId, 'completed', note));
                      }}
                    >
                      {__uiText('ทำเครื่องหมายว่าสำเร็จ')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className={`${btn} border border-red-300 bg-white text-red-700`}
                      onClick={() => {
                        const note = askReason(__uiText('KBank ไม่ได้คืนเงิน (หมายเหตุ)'));
                        if (note) void run(() => resolveRefundRequest(d.refundRequestId, 'failed', note));
                      }}
                    >
                      {__uiText('ทำเครื่องหมายว่าล้มเหลว')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

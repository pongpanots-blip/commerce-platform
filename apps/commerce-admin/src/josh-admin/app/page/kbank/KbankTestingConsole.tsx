// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import {
  backdateKbankTestTransaction,
  createKbankTestQrOrder,
  createKbankTestTransaction,
  forceKbankTestTransactionProcessing,
  KbankQrOrderResult,
  KbankSimulateNotifyTamper,
  KbankTestCase,
  KbankTestCaseResult,
  KbankTestTransaction,
  listKbankChecklist,
  listKbankTestTransactions,
  reconcileKbankNow,
  simulateKbankNotify,
  updateKbankChecklist,
} from '@josh/shared-api';
import { Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useMemo, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  processing: 'bg-amber-100 text-amber-700',
  success: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>
  );
}

function unwrap<T>(res: any): T {
  return (res?.data?.data ?? res?.data ?? res) as T;
}

function ageLabel(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีก่อน`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} ชม.${mins % 60} นาทีก่อน`;
}

const AMOUNT_MISMATCH_DELTA = 100;

const NOTIFY_PRESETS: {
  label: string;
  note?: string;
  patch: Partial<{
    transaction_state: string;
    status: string;
    livemode: boolean;
    tamper: KbankSimulateNotifyTamper | '';
  }>;
  /** ต้องมีแถวที่เลือกไว้ก่อน — ใช้คำนวณ amount ที่ตั้งใจให้ไม่ตรงกับแถวนั้น */
  requiresSelectedRow?: boolean;
}[] = [
  { label: 'สำเร็จ (Authorized + success)', patch: { transaction_state: 'Authorized', status: 'success', tamper: '' } },
  {
    label: 'Pre-Authorized + success',
    note: 'ห้ามถือว่าจ่ายแล้ว — แค่ authorize ยังไม่ capture',
    patch: { transaction_state: 'Pre-Authorized', status: 'success', tamper: '' },
  },
  { label: 'Declined', patch: { transaction_state: 'Declined', status: 'fail', tamper: '' } },
  { label: 'Voided', patch: { transaction_state: 'Voided', status: 'fail', tamper: '' } },
  { label: 'checksum ผิด', patch: { transaction_state: 'Authorized', status: 'success', tamper: 'bad-checksum' } },
  { label: 'ไม่มี checksum', patch: { transaction_state: 'Authorized', status: 'success', tamper: 'no-checksum' } },
  { label: 'livemode ไม่ตรง', patch: { transaction_state: 'Authorized', status: 'success', livemode: true, tamper: '' } },
  {
    label: 'ยอดไม่ตรง',
    note: `ต้องเลือกแถวก่อน — จะยิงยอด = ยอดแถวนั้น + ${AMOUNT_MISMATCH_DELTA}`,
    patch: { transaction_state: 'Authorized', status: 'success', tamper: '' },
    requiresSelectedRow: true,
  },
];

export default function KbankTestingConsole() {
  const [rows, setRows] = useState<KbankTestTransaction[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [createError, setCreateError] = useState('');
  const [qrOrderAmount, setQrOrderAmount] = useState('');
  const [qrOrderResult, setQrOrderResult] = useState<KbankQrOrderResult | null>(null);
  const [qrOrderError, setQrOrderError] = useState('');
  const [qrOrderSubmitting, setQrOrderSubmitting] = useState(false);
  const [backdateMinutes, setBackdateMinutes] = useState<Record<string, string>>({});
  const [rowActionError, setRowActionError] = useState('');
  const [selectedRow, setSelectedRow] = useState<KbankTestTransaction | null>(null);
  const [presetError, setPresetError] = useState('');
  const [checklistError, setChecklistError] = useState('');

  const [notifyForm, setNotifyForm] = useState({
    reference: '',
    transaction_state: 'Authorized',
    status: 'success',
    livemode: false,
    amount: '',
    objectType: 'charge' as 'charge' | 'qr',
    tamper: '' as KbankSimulateNotifyTamper | '',
  });
  const [notifyOutcome, setNotifyOutcome] = useState<any>(null);
  const [notifySubmitting, setNotifySubmitting] = useState(false);

  const [checklist, setChecklist] = useState<KbankTestCase[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(true);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const [reconcileMessage, setReconcileMessage] = useState('');
  const [reconcileIsError, setReconcileIsError] = useState(false);

  const loadRows = async () => {
    setLoadingRows(true);
    try {
      const res = await listKbankTestTransactions(50);
      setRows(unwrap<KbankTestTransaction[]>(res) ?? []);
    } finally {
      setLoadingRows(false);
    }
  };

  const loadChecklist = async () => {
    setLoadingChecklist(true);
    try {
      const res = await listKbankChecklist();
      const list = unwrap<KbankTestCase[]>(res) ?? [];
      setChecklist(list);
      const drafts: Record<string, string> = {};
      for (const item of list) drafts[item.code] = item.note ?? '';
      setNoteDrafts(drafts);
    } finally {
      setLoadingChecklist(false);
    }
  };

  useEffect(() => {
    void loadRows();
    void loadChecklist();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    try {
      await createKbankTestTransaction({
        amount: Number(amount),
        reference: reference.trim() || undefined,
      });
      setAmount('');
      setReference('');
      await loadRows();
    } catch (err: any) {
      setCreateError(err?.response?.data?.message ?? err?.message ?? 'สร้างไม่สำเร็จ');
    }
  };

  const handleCreateQrOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setQrOrderError('');
    setQrOrderSubmitting(true);
    try {
      const res = await createKbankTestQrOrder(Number(qrOrderAmount));
      setQrOrderResult(unwrap<KbankQrOrderResult>(res));
    } catch (err: any) {
      setQrOrderError(err?.response?.data?.message ?? err?.message ?? 'สร้าง QR order ไม่สำเร็จ');
    } finally {
      setQrOrderSubmitting(false);
    }
  };

  const handleBackdate = async (id: string) => {
    const minutes = Number(backdateMinutes[id] ?? '0');
    if (!minutes) return;
    setRowActionError('');
    try {
      await backdateKbankTestTransaction(id, minutes);
      await loadRows();
    } catch (err: any) {
      setRowActionError(err?.response?.data?.message ?? err?.message ?? 'backdate ไม่สำเร็จ');
    }
  };

  const handleForceProcessing = async (id: string) => {
    setRowActionError('');
    try {
      await forceKbankTestTransactionProcessing(id);
      await loadRows();
    } catch (err: any) {
      setRowActionError(err?.response?.data?.message ?? err?.message ?? 'force-processing ไม่สำเร็จ');
    }
  };

  const selectRowIntoNotify = (row: KbankTestTransaction) => {
    setSelectedRow(row);
    setNotifyForm((f) => ({ ...f, reference: row.gateway_charge_id, amount: String(row.amount) }));
  };

  const oneClickSuccessNotify = async (row: KbankTestTransaction) => {
    setSelectedRow(row);
    const res = await simulateKbankNotify({
      reference: row.gateway_charge_id,
      transaction_state: 'Authorized',
      status: 'success',
      livemode: false, // ต้อง != is_test (true) ของแถวทดสอบ ไม่งั้น handleNotify จะ ignore เป็น livemode-mismatch
    });
    setNotifyOutcome(unwrap(res));
    setNotifyForm((f) => ({
      ...f,
      reference: row.gateway_charge_id,
      transaction_state: 'Authorized',
      status: 'success',
      livemode: false,
      tamper: '',
    }));
    await loadRows();
  };

  const applyPreset = (preset: (typeof NOTIFY_PRESETS)[number]) => {
    setPresetError('');
    if (preset.requiresSelectedRow) {
      if (!selectedRow) {
        setPresetError('กรุณาเลือกแถวทดสอบ (คลิก Reference ในตาราง) ก่อนใช้ preset นี้');
        return;
      }
      const mismatchedAmount = Number(selectedRow.amount) + AMOUNT_MISMATCH_DELTA;
      setNotifyForm((f) => ({
        ...f,
        ...preset.patch,
        reference: selectedRow.gateway_charge_id,
        amount: String(mismatchedAmount),
      }));
      return;
    }
    setNotifyForm((f) => ({ ...f, ...preset.patch }));
  };

  const submitNotify = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotifySubmitting(true);
    try {
      const res = await simulateKbankNotify({
        reference: notifyForm.reference,
        transaction_state: notifyForm.transaction_state || undefined,
        status: notifyForm.status || undefined,
        livemode: notifyForm.livemode,
        amount: notifyForm.amount ? Number(notifyForm.amount) : undefined,
        objectType: notifyForm.objectType,
        tamper: notifyForm.tamper || undefined,
      });
      setNotifyOutcome(unwrap(res));
      await loadRows();
    } catch (err: any) {
      setNotifyOutcome({
        httpStatus: err?.response?.status ?? 0,
        error: { name: 'RequestError', message: err?.response?.data?.message ?? err?.message },
      });
    } finally {
      setNotifySubmitting(false);
    }
  };

  const copyPayload = async () => {
    if (!notifyOutcome) return;
    await navigator.clipboard.writeText(JSON.stringify(notifyOutcome, null, 2));
  };

  const handleReconcile = async () => {
    setReconcileIsError(false);
    setReconcileMessage('กำลังรัน...');
    try {
      await reconcileKbankNow();
      setReconcileIsError(false);
      setReconcileMessage('รันเสร็จแล้ว — ดูสถานะแถวทดสอบด้านบนเพื่อยืนยันผล');
      await loadRows();
    } catch (err: any) {
      setReconcileIsError(true);
      setReconcileMessage(err?.response?.data?.message ?? err?.message ?? 'reconcile ไม่สำเร็จ');
    }
  };

  const handleChecklistResultChange = async (item: KbankTestCase, result: KbankTestCaseResult) => {
    setChecklistError('');
    try {
      await updateKbankChecklist(item.code, { result, note: noteDrafts[item.code] });
      await loadChecklist();
    } catch (err: any) {
      setChecklistError(err?.response?.data?.message ?? err?.message ?? 'บันทึกผลไม่สำเร็จ');
    }
  };

  const handleNoteBlur = async (item: KbankTestCase) => {
    const note = noteDrafts[item.code] ?? '';
    if (note === (item.note ?? '')) return;
    setChecklistError('');
    try {
      await updateKbankChecklist(item.code, { result: item.result, note });
      await loadChecklist();
    } catch (err: any) {
      setChecklistError(err?.response?.data?.message ?? err?.message ?? 'บันทึก note ไม่สำเร็จ');
    }
  };

  const kpgItems = useMemo(() => checklist.filter((c) => c.group === 'kpg'), [checklist]);
  const plItems = useMemo(() => checklist.filter((c) => c.group === 'payment_link'), [checklist]);

  const columns: TableColumn<KbankTestTransaction>[] = [
    {
      key: 'gateway_charge_id',
      label: 'Reference',
      render: (v, row) => (
        <button
          type="button"
          className="text-left text-primary underline-offset-2 hover:underline"
          onClick={() => selectRowIntoNotify(row)}
          title="เลือกแถวนี้เข้า Simulate notify"
        >
          {String(v)}
        </button>
      ),
    },
    { key: 'amount', label: 'จำนวน', render: (v) => Number(v).toLocaleString() },
    { key: 'status', label: 'สถานะ', render: (v) => <StatusBadge status={String(v)} /> },
    { key: 'created_at', label: 'สร้างเมื่อ', render: (v) => new Date(String(v)).toLocaleString('th-TH') },
    { key: 'created_at', label: 'อายุ', render: (v) => ageLabel(String(v)) },
    {
      key: 'id',
      label: 'จัดการ',
      render: (id, row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            placeholder="นาที"
            aria-label={`ย้อนเวลารายการ ${String(id)} (นาที)`}
            className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs"
            value={backdateMinutes[String(id)] ?? ''}
            onChange={(e) => setBackdateMinutes((m) => ({ ...m, [String(id)]: e.target.value }))}
          />
          <button
            type="button"
            className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
            onClick={() => void handleBackdate(String(id))}
          >
            Backdate
          </button>
          <button
            type="button"
            className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700 hover:bg-amber-200"
            onClick={() => void handleForceProcessing(String(id))}
          >
            Force processing
          </button>
          <button
            type="button"
            className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
            onClick={() => void oneClickSuccessNotify(row)}
          >
            Simulate success notify
          </button>
        </div>
      ),
    },
  ];

  const checklistColumns = (): TableColumn<KbankTestCase>[] => [
    { key: 'code', label: 'Code' },
    {
      key: 'title',
      label: 'Title',
      render: (v, row) =>
        !row.exercisable ? (
          <span>
            {String(v)}{' '}
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500" title="ต้องมีขา 'สร้างรายการชำระเงิน' ก่อน — รอรอบถัดไป">
              ไล่ไม่ได้ในรอบ 1
            </span>
          </span>
        ) : (
          String(v)
        ),
    },
    {
      key: 'result',
      label: 'ผล',
      render: (v, row) => {
        const restricted = !row.exercisable;
        return (
          <div className="flex items-center gap-1.5">
            <Select
              aria-label={`ผลการทดสอบ ${row.code}`}
              value={String(v)}
              onChange={(e) => void handleChecklistResultChange(row, e.target.value as KbankTestCaseResult)}
            >
              <option value="not_tested">not_tested</option>
              {!restricted && <option value="pass">pass</option>}
              {!restricted && <option value="fail">fail</option>}
              <option value="na">na</option>
            </Select>
            {restricted && (
              <span
                className="text-[11px] text-gray-400"
                title="ไล่ไม่ได้ในรอบ 1 — เลือกได้แค่ not_tested หรือ na, ห้ามตั้ง pass/fail จนกว่าจะไล่ได้จริง"
              >
                จำกัดผลได้แค่ not_tested/na
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'note',
      label: 'Note',
      render: (_v, row) => (
        <input
          type="text"
          aria-label={`Note ของ ${row.code}`}
          className="w-full min-w-[160px] rounded border border-gray-300 px-2 py-1 text-xs"
          value={noteDrafts[row.code] ?? ''}
          onChange={(e) => setNoteDrafts((d) => ({ ...d, [row.code]: e.target.value }))}
          onBlur={() => void handleNoteBlur(row)}
        />
      ),
    },
  ];

  return (
    <div className="p-6">
      <AdminListHeader title="KBank Testing Console" subtitle="Manual QA console สำหรับไล่ checklist เซอร์ทิฟาย K-Payment Gateway" />

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
        Console นี้ปิดอยู่บน production เสมอ ยกเว้นตั้ง <code>KBANK_TESTING_CONSOLE=true</code> — และทุก endpoint ปฏิเสธแถวที่ไม่ใช่รายการทดสอบ (is_test) เสมอ
      </div>

      {/* Region 1 — Test transactions */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">1. Test transactions</h2>
        <form
          className="mb-4 grid max-w-xl gap-3 rounded-lg border border-gray-100 p-4 md:grid-cols-3"
          onSubmit={(e) => void handleCreate(e)}
        >
          <Input label="จำนวนเงิน" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <Input label="Reference (ไม่บังคับ)" value={reference} onChange={(e) => setReference(e.target.value)} />
          <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm text-white">
            สร้างรายการทดสอบ
          </button>
          {createError && <p className="md:col-span-3 text-xs text-red-600">{createError}</p>}
        </form>
        {rowActionError && <p className="mb-2 text-xs text-red-600">{rowActionError}</p>}
        <Table columns={columns} data={rows} loading={loadingRows} />

        <form
          className="mt-4 flex max-w-xl flex-wrap items-end gap-3 rounded-lg border border-gray-100 p-4"
          onSubmit={(e) => void handleCreateQrOrder(e)}
        >
          <Input
            label="จำนวนเงิน (QR order)"
            type="number"
            value={qrOrderAmount}
            onChange={(e) => setQrOrderAmount(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={qrOrderSubmitting}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {qrOrderSubmitting ? 'กำลังสร้าง...' : 'สร้าง QR order จริง (sandbox)'}
          </button>
          <span className="text-xs text-gray-500">
            เรียกธนาคาร sandbox จริง — ใช้เพื่อสแกนจ่ายด้วย Test Simulator สำหรับปิด KPG [1]
          </span>
          {qrOrderError && <p className="w-full text-xs text-red-600">{qrOrderError}</p>}
        </form>

        {qrOrderResult && (
          <div className="mt-3 max-w-xl rounded-lg border border-gray-100 bg-gray-50 p-4 text-xs text-gray-700">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium">orderId:</span>
              <code className="select-all rounded bg-white px-2 py-0.5">{qrOrderResult.orderId}</code>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">referenceOrder:</span>
              <code className="select-all rounded bg-white px-2 py-0.5">{qrOrderResult.referenceOrder}</code>
            </div>
          </div>
        )}
      </section>

      {/* Region 2 — Simulate notify */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">2. Simulate notify</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {NOTIFY_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              title={preset.note}
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
            onClick={() => void submitNotify({ preventDefault: () => {} } as any)}
            title="ยิง payload เดิมซ้ำอีกครั้ง (notify ซ้ำ)"
          >
            notify ซ้ำ (resend เดิม)
          </button>
        </div>
        {presetError && <p className="mb-2 text-xs text-red-600">{presetError}</p>}

        <form className="grid gap-3 rounded-lg border border-gray-100 p-4 md:grid-cols-3" onSubmit={(e) => void submitNotify(e)}>
          <Input label="Reference" value={notifyForm.reference} onChange={(e) => setNotifyForm((f) => ({ ...f, reference: e.target.value }))} required />
          <Input label="สถานะธุรกรรม (transaction_state)" value={notifyForm.transaction_state} onChange={(e) => setNotifyForm((f) => ({ ...f, transaction_state: e.target.value }))} />
          <Input label="สถานะ (status)" value={notifyForm.status} onChange={(e) => setNotifyForm((f) => ({ ...f, status: e.target.value }))} />
          <Input label="จำนวนเงิน (ไม่บังคับ)" type="number" value={notifyForm.amount} onChange={(e) => setNotifyForm((f) => ({ ...f, amount: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={notifyForm.livemode} onChange={(e) => setNotifyForm((f) => ({ ...f, livemode: e.target.checked }))} />
            โหมดจริง (livemode)
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">ประเภทรายการ</span>
            <Select
              aria-label="ประเภทรายการ"
              value={notifyForm.objectType}
              onChange={(e) => setNotifyForm((f) => ({ ...f, objectType: e.target.value as 'charge' | 'qr' }))}
            >
              <option value="charge">charge</option>
              <option value="qr">qr</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1 md:col-span-3">
            <span className="text-xs text-gray-500">จำลองข้อมูลผิดพลาด (tamper)</span>
            <Select
              aria-label="จำลองข้อมูลผิดพลาด (tamper)"
              value={notifyForm.tamper}
              onChange={(e) => setNotifyForm((f) => ({ ...f, tamper: e.target.value as KbankSimulateNotifyTamper | '' }))}
            >
              <option value="">tamper: ไม่มี (payload ถูกต้อง)</option>
              <option value="bad-checksum">bad-checksum</option>
              <option value="no-checksum">no-checksum</option>
              <option value="no-reference">no-reference</option>
              <option value="string-livemode">string-livemode</option>
            </Select>
          </div>
          <button type="submit" disabled={notifySubmitting} className="md:col-span-3 rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">
            {notifySubmitting ? 'กำลังส่ง...' : 'ยิง Simulate notify'}
          </button>
        </form>

        {notifyOutcome && (
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                httpStatus: {notifyOutcome.httpStatus}
                {notifyOutcome.error ? ` — ${notifyOutcome.error.name}: ${notifyOutcome.error.message}` : ''}
              </span>
              <button type="button" className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300" onClick={() => void copyPayload()}>
                Copy JSON
              </button>
            </div>
            <pre className="max-h-96 overflow-auto rounded bg-white p-3 text-xs text-gray-700">{JSON.stringify(notifyOutcome, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Region 3 — Certification checklist */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">3. Certification checklist</h2>
        <div className="mb-3 flex items-center gap-3">
          <button type="button" className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-white" onClick={() => void handleReconcile()}>
            Reconcile now
          </button>
          <span className="text-xs text-gray-500">
            รัน reconciler sweep ทันที เฉพาะแถวทดสอบเท่านั้น (is_test=true) ไม่แตะรายการเงินจริง
          </span>
          {reconcileMessage && (
            <span className={`text-xs ${reconcileIsError ? 'text-red-600' : 'text-emerald-600'}`}>
              {reconcileMessage}
            </span>
          )}
        </div>
        {checklistError && <p className="mb-3 text-xs text-red-600">{checklistError}</p>}

        <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">KPG</h3>
        <div className="mb-6">
          <Table columns={checklistColumns()} data={kpgItems} loading={loadingChecklist} />
        </div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">Payment Link</h3>
        <Table columns={checklistColumns()} data={plItems} loading={loadingChecklist} />
      </section>
    </div>
  );
}

// @ts-nocheck — copied from josh web-admin; existing upstream type errors remain. Request failures are surfaced in the Commerce workspace.
// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
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

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Button, Chip, StatusChip } from "@cp/ui";

/** ป้ายผลการทดสอบ — ค่าที่บันทึกยังเป็นรหัสเดิม */
const RESULT_LABEL: Record<string, string> = {
  get not_tested(){return __uiText("ยังไม่ทดสอบ");},
  get pass(){return __uiText("ผ่าน");},
  get fail(){return __uiText("ไม่ผ่าน");},
  get na(){return __uiText("ไม่เกี่ยวข้อง");},
};

function unwrap<T>(res: any): T {
  return (res?.data?.data ?? res?.data ?? res) as T;
}

function ageLabel(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return __uiText("เมื่อสักครู่");
  if (mins < 60) return __uiText("{0} นาทีก่อน",{"0":mins});
  const hrs = Math.floor(mins / 60);
  return __uiText("{0} ชม.{1} นาทีก่อน",{"0":hrs,"1":mins % 60});
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
  { get label() { return __uiText("สำเร็จ (Authorized + success)"); }, patch: { transaction_state: 'Authorized', status: 'success', tamper: '' } },
  {
    get label() { return __uiText("อนุมัติล่วงหน้า (Pre-Authorized)"); },
    get note() { return __uiText("ห้ามถือว่าจ่ายแล้ว — แค่อนุมัติวงเงิน ยังไม่ตัดเงินจริง"); },
    patch: { transaction_state: 'Pre-Authorized', status: 'success', tamper: '' },
  },
  { get label() { return __uiText("ถูกปฏิเสธ (Declined)"); }, patch: { transaction_state: 'Declined', status: 'fail', tamper: '' } },
  { get label() { return __uiText("ยกเลิกรายการ (Voided)"); }, patch: { transaction_state: 'Voided', status: 'fail', tamper: '' } },
  { get label() { return __uiText("checksum ผิด"); }, patch: { transaction_state: 'Authorized', status: 'success', tamper: 'bad-checksum' } },
  { get label() { return __uiText("ไม่มี checksum"); }, patch: { transaction_state: 'Authorized', status: 'success', tamper: 'no-checksum' } },
  { get label() { return __uiText("livemode ไม่ตรง"); }, patch: { transaction_state: 'Authorized', status: 'success', livemode: true, tamper: '' } },
  {
    get label() { return __uiText("ยอดไม่ตรง"); },
    get note() { return __uiText("ต้องเลือกแถวก่อน — จะส่งยอด = ยอดแถวนั้น + {0}", { "0": AMOUNT_MISMATCH_DELTA }); },
    patch: { transaction_state: 'Authorized', status: 'success', tamper: '' },
    requiresSelectedRow: true,
  },
];

export default function KbankTestingConsole() {
  __useUiLocale();
  const [rows, setRows] = useState<KbankTestTransaction[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [rowsError, setRowsError] = useState('');
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
    setRowsError('');
    try {
      const res = await listKbankTestTransactions(50);
      setRows(unwrap<KbankTestTransaction[]>(res) ?? []);
    } catch (err) {
      setRowsError(err instanceof Error ? err.message : __uiMessage("โหลดรายการทดสอบไม่สำเร็จ"));
    } finally {
      setLoadingRows(false);
    }
  };

  const loadChecklist = async () => {
    setLoadingChecklist(true);
    setChecklistError('');
    try {
      const res = await listKbankChecklist();
      const list = unwrap<KbankTestCase[]>(res) ?? [];
      setChecklist(list);
      const drafts: Record<string, string> = {};
      for (const item of list) drafts[item.code] = item.note ?? '';
      setNoteDrafts(drafts);
    } catch (err) {
      setChecklistError(err instanceof Error ? err.message : __uiMessage("โหลดรายการตรวจสอบไม่สำเร็จ"));
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
      setCreateError(err?.response?.data?.message ?? err?.message ?? __uiMessage("สร้างไม่สำเร็จ"));
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
      setQrOrderError(err?.response?.data?.message ?? err?.message ?? __uiMessage("สร้าง QR order ไม่สำเร็จ"));
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
      setRowActionError(err?.response?.data?.message ?? err?.message ?? __uiMessage("backdate ไม่สำเร็จ"));
    }
  };

  const handleForceProcessing = async (id: string) => {
    setRowActionError('');
    try {
      await forceKbankTestTransactionProcessing(id);
      await loadRows();
    } catch (err: any) {
      setRowActionError(err?.response?.data?.message ?? err?.message ?? __uiMessage("force-processing ไม่สำเร็จ"));
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
        setPresetError(__uiMessage("กรุณาเลือกแถวทดสอบ (คลิก Reference ในตาราง) ก่อนใช้ preset นี้"));
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
    setReconcileMessage(__uiText('กำลังรัน...'));
    try {
      await reconcileKbankNow();
      setReconcileIsError(false);
      setReconcileMessage(__uiText('รันเสร็จแล้ว — ดูสถานะแถวทดสอบด้านบนเพื่อยืนยันผล'));
      await loadRows();
    } catch (err: any) {
      setReconcileIsError(true);
      setReconcileMessage(err?.response?.data?.message ?? err?.message ?? __uiText('กระทบยอดไม่สำเร็จ'));
    }
  };

  const handleChecklistResultChange = async (item: KbankTestCase, result: KbankTestCaseResult) => {
    setChecklistError('');
    try {
      await updateKbankChecklist(item.code, { result, note: noteDrafts[item.code] });
      await loadChecklist();
    } catch (err: any) {
      setChecklistError(err?.response?.data?.message ?? err?.message ?? __uiMessage("บันทึกผลไม่สำเร็จ"));
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
      setChecklistError(err?.response?.data?.message ?? err?.message ?? __uiMessage("บันทึก note ไม่สำเร็จ"));
    }
  };

  const kpgItems = useMemo(() => checklist.filter((c) => c.group === 'kpg'), [checklist]);
  const plItems = useMemo(() => checklist.filter((c) => c.group === 'payment_link'), [checklist]);

  const columns: TableColumn<KbankTestTransaction>[] = [
    {
      key: 'gateway_charge_id',
      label: __uiText("รหัสอ้างอิง"),
      render: (v, row) => (
        <button
          type="button"
          className="text-left font-mono text-xs text-primary underline-offset-2 hover:underline"
          onClick={() => selectRowIntoNotify(row)}
          title={__uiText("เลือกแถวนี้ไปใช้จำลองการแจ้งผล")}
        >
          {String(v)}
        </button>
      ),
    },
    { key: 'amount', label: __uiText("จำนวน"), align: 'right', render: (v) => <span className="tabular-nums">{Number(v).toLocaleString()}</span> },
    { key: 'status', label: __uiText("สถานะ"), render: (v) => <StatusChip status={String(v)} /> },
    { key: 'created_at', label: __uiText("สร้างเมื่อ"), render: (v) => <span className="whitespace-nowrap tabular-nums">{new Date(String(v)).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}</span> },
    { key: 'created_at', label: __uiText("อายุ"), render: (v) => ageLabel(String(v)) },
    {
      key: 'id',
      label: __uiText("จัดการ"),
      render: (id, row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            placeholder={__uiText("นาที")}
            aria-label={__uiText("ย้อนเวลารายการ {0} (นาที)", {"0": String(id)})}
            className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs"
            value={backdateMinutes[String(id)] ?? ''}
            onChange={(e) => setBackdateMinutes((m) => ({ ...m, [String(id)]: e.target.value }))}
          />
          <Button size="sm" onClick={() => void handleBackdate(String(id))}>
            {__uiText("ย้อนเวลา")}</Button>
          <Button size="sm" onClick={() => void handleForceProcessing(String(id))}>
            {__uiText("บังคับเป็นกำลังดำเนินการ")}</Button>
          <Button size="sm" onClick={() => void oneClickSuccessNotify(row)}>
            {__uiText("จำลองแจ้งผลสำเร็จ")}</Button>
        </div>
      ),
    },
  ];

  const checklistColumns = (): TableColumn<KbankTestCase>[] => [
    { key: 'code', label: __uiText("รหัส"), render: (v) => <span className="font-mono text-xs">{String(v)}</span> },
    {
      key: 'title',
      label: __uiText("หัวข้อ"),
      render: (v, row) =>
        !row.exercisable ? (
          <span>
            {String(v)}{' '}
            <span title={__uiText("ต้องมีขา 'สร้างรายการชำระเงิน' ก่อน — รอรอบถัดไป")}>
              <Chip>{__uiText("ไล่ไม่ได้ในรอบ 1")}</Chip></span>
          </span>
        ) : (
          String(v)
        ),
    },
    {
      key: 'result',
      label: __uiText("ผล"),
      render: (v, row) => {
        const restricted = !row.exercisable;
        return (
          <div className="flex items-center gap-1.5">
            <Select
              aria-label={__uiText("ผลการทดสอบ {0}", {"0": row.code})}
              value={String(v)}
              onChange={(e) => void handleChecklistResultChange(row, e.target.value as KbankTestCaseResult)}
            >
              <option value="not_tested">{RESULT_LABEL.not_tested}</option>
              {!restricted && <option value="pass">{RESULT_LABEL.pass}</option>}
              {!restricted && <option value="fail">{RESULT_LABEL.fail}</option>}
              <option value="na">{RESULT_LABEL.na}</option>
            </Select>
            {restricted && (
              <span
                className="text-[11px] text-gray-400"
                title={__uiText("ไล่ไม่ได้ในรอบ 1 — เลือกได้แค่ ยังไม่ทดสอบ หรือ ไม่เกี่ยวข้อง จนกว่าจะไล่ได้จริง")}
              >
                {__uiText("เลือกได้แค่ ยังไม่ทดสอบ / ไม่เกี่ยวข้อง")}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'note',
      label: __uiText("บันทึก"),
      render: (_v, row) => (
        <input
          type="text"
          aria-label={__uiText("Note ของ {0}", {"0": row.code})}
          className="w-full min-w-[160px] rounded border border-gray-300 px-2 py-1 text-xs"
          value={noteDrafts[row.code] ?? ''}
          onChange={(e) => setNoteDrafts((d) => ({ ...d, [row.code]: e.target.value }))}
          onBlur={() => void handleNoteBlur(row)}
        />
      ),
    },
  ];

  return (
    <div className="cp-management-page">
      <AdminListHeader title={__uiText("ทดสอบชำระเงิน KBank")} subtitle={__uiText("ทดสอบการชำระเงินผ่าน KBank")} />

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
        {__uiText("Console นี้ปิดอยู่บน production เสมอ ยกเว้นตั้ง ")}<code>{__uiText("KBANK_TESTING_CONSOLE=true")}</code> {__uiText(" — และทุก endpoint ปฏิเสธแถวที่ไม่ใช่รายการทดสอบ (is_test) เสมอ")}</div>

      {/* Region 1 — Test transactions */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{__uiText("1. รายการทดสอบ")}</h2>
        <form
          className="mb-4 grid max-w-xl gap-3 rounded-lg border border-gray-100 p-4 md:grid-cols-3"
          onSubmit={(e) => void handleCreate(e)}
        >
          <Input label={__uiText("จำนวนเงิน")} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <Input label={__uiText("รหัสอ้างอิง (ไม่บังคับ)")} value={reference} onChange={(e) => setReference(e.target.value)} />
          <Button type="submit" variant="primary" className="self-end">
            {__uiText("สร้างรายการทดสอบ")}</Button>
          {createError && <p className="md:col-span-3 text-xs text-red-600">{(typeof (createError) === 'string' ? __uiText(createError) : createError)}</p>}
        </form>
        {rowActionError && <p className="mb-2 text-xs text-red-600">{(typeof (rowActionError) === 'string' ? __uiText(rowActionError) : rowActionError)}</p>}
        {rowsError ? <p role="alert" className="text-sm text-red-600">{(typeof (rowsError) === 'string' ? __uiText(rowsError) : rowsError)}</p> : <Table columns={columns} data={rows} loading={loadingRows} emptyTitle={__uiText("ยังไม่มีรายการทดสอบ")} emptyDescription={__uiText("กรอกจำนวนเงินด้านบน แล้วกดสร้างรายการทดสอบ")} />}

        <form
          className="mt-4 flex max-w-xl flex-wrap items-end gap-3 rounded-lg border border-gray-100 p-4"
          onSubmit={(e) => void handleCreateQrOrder(e)}
        >
          <Input
            label={__uiText("จำนวนเงิน (QR order)")}
            type="number"
            value={qrOrderAmount}
            onChange={(e) => setQrOrderAmount(e.target.value)}
            required
          />
          <Button type="submit" disabled={qrOrderSubmitting}>
            {qrOrderSubmitting ? __uiText("กำลังสร้าง...") : __uiText("สร้าง QR order จริง (sandbox)")}
          </Button>
          <span className="text-xs text-gray-500">
            {__uiText("เรียกธนาคาร sandbox จริง — ใช้เพื่อสแกนจ่ายด้วย Test Simulator สำหรับปิด KPG [1]")}</span>
          {qrOrderError && <p className="w-full text-xs text-red-600">{(typeof (qrOrderError) === 'string' ? __uiText(qrOrderError) : qrOrderError)}</p>}
        </form>

        {qrOrderResult && (
          <div className="mt-3 max-w-xl rounded-lg border border-gray-100 bg-gray-50 p-4 text-xs text-gray-700">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium">{__uiText("orderId:")}</span>
              <code className="select-all rounded bg-white px-2 py-0.5 font-mono">{qrOrderResult.orderId}</code>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{__uiText("referenceOrder:")}</span>
              <code className="select-all rounded bg-white px-2 py-0.5 font-mono">{qrOrderResult.referenceOrder}</code>
            </div>
          </div>
        )}
      </section>

      {/* Region 2 — Simulate notify */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{__uiText("2. จำลองการแจ้งผลจากธนาคาร")}</h2>
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
            title={__uiText("ส่งข้อมูลชุดเดิมซ้ำอีกครั้ง (แจ้งผลซ้ำ)")}
          >
            {__uiText("ส่งซ้ำค่าเดิม")}</button>
        </div>
        {presetError && <p className="mb-2 text-xs text-red-600">{(typeof (presetError) === 'string' ? __uiText(presetError) : presetError)}</p>}

        <form className="grid gap-3 rounded-lg border border-gray-100 p-4 md:grid-cols-3" onSubmit={(e) => void submitNotify(e)}>
          <Input label={__uiText("รหัสอ้างอิง")} value={notifyForm.reference} onChange={(e) => setNotifyForm((f) => ({ ...f, reference: e.target.value }))} required />
          <Input label={__uiText("สถานะธุรกรรม (transaction_state)")} value={notifyForm.transaction_state} onChange={(e) => setNotifyForm((f) => ({ ...f, transaction_state: e.target.value }))} />
          <Input label={__uiText("สถานะ (status)")} value={notifyForm.status} onChange={(e) => setNotifyForm((f) => ({ ...f, status: e.target.value }))} />
          <Input label={__uiText("จำนวนเงิน (ไม่บังคับ)")} type="number" value={notifyForm.amount} onChange={(e) => setNotifyForm((f) => ({ ...f, amount: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={notifyForm.livemode} onChange={(e) => setNotifyForm((f) => ({ ...f, livemode: e.target.checked }))} />
            {__uiText("โหมดจริง (livemode)")}</label>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">{__uiText("ประเภทรายการ")}</span>
            <Select
              aria-label={__uiText("ประเภทรายการ")}
              value={notifyForm.objectType}
              onChange={(e) => setNotifyForm((f) => ({ ...f, objectType: e.target.value as 'charge' | 'qr' }))}
            >
              <option value="charge">{__uiText("ตัดบัตร (charge)")}</option>
              <option value="qr">{__uiText("QR (qr)")}</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1 md:col-span-3">
            <span className="text-xs text-gray-500">{__uiText("จำลองข้อมูลผิดพลาด (tamper)")}</span>
            <Select
              aria-label={__uiText("จำลองข้อมูลผิดพลาด (tamper)")}
              value={notifyForm.tamper}
              onChange={(e) => setNotifyForm((f) => ({ ...f, tamper: e.target.value as KbankSimulateNotifyTamper | '' }))}
            >
              <option value="">{__uiText("tamper: ไม่มี (payload ถูกต้อง)")}</option>
              <option value="bad-checksum">{__uiText("checksum ผิด (bad-checksum)")}</option>
              <option value="no-checksum">{__uiText("ไม่มี checksum (no-checksum)")}</option>
              <option value="no-reference">{__uiText("ไม่มีรหัสอ้างอิง (no-reference)")}</option>
              <option value="string-livemode">{__uiText("livemode เป็นข้อความ (string-livemode)")}</option>
            </Select>
          </div>
          <Button type="submit" variant="primary" disabled={notifySubmitting} className="md:col-span-3">
            {notifySubmitting ? __uiText("กำลังส่ง...") : __uiText("ส่งการแจ้งผลจำลอง")}
          </Button>
        </form>

        {notifyOutcome && (
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {__uiText("httpStatus: ")}{notifyOutcome.httpStatus}
                {notifyOutcome.error ? ` — ${notifyOutcome.error.name}: ${notifyOutcome.error.message}` : ''}
              </span>
              <Button size="sm" onClick={() => void copyPayload()}>
                {__uiText("คัดลอก JSON")}</Button>
            </div>
            <pre className="max-h-96 overflow-auto rounded bg-white p-3 font-mono text-xs text-gray-700">{JSON.stringify(notifyOutcome, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Region 3 — Certification checklist */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{__uiText("3. รายการตรวจรับรอง")}</h2>
        <div className="mb-3 flex items-center gap-3">
          <Button onClick={() => void handleReconcile()}>
            {__uiText("กระทบยอดตอนนี้")}</Button>
          <span className="text-xs text-gray-500">
            {__uiText("รัน reconciler sweep ทันที เฉพาะแถวทดสอบเท่านั้น (is_test=true) ไม่แตะรายการเงินจริง")}</span>
          {reconcileMessage && (
            <span className={`text-xs ${reconcileIsError ? 'text-red-600' : 'text-emerald-600'}`}>
              {reconcileMessage}
            </span>
          )}
        </div>
        {checklistError && <p className="mb-3 text-xs text-red-600">{(typeof (checklistError) === 'string' ? __uiText(checklistError) : checklistError)}</p>}

        <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">{__uiText("KPG")}</h3>
        <div className="mb-6">
          <Table columns={checklistColumns()} data={kpgItems} loading={loadingChecklist} />
        </div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">{__uiText("Payment Link")}</h3>
        <Table columns={checklistColumns()} data={plItems} loading={loadingChecklist} />
      </section>
    </div>
  );
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

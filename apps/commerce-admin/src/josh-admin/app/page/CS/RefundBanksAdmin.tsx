import {
  createRefundBank,
  listRefundBanks,
  updateRefundBank,
  type RefundBankAdmin,
  type RefundBankInput,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import {
  Button as CpButton,
  Chip,
  getUiLocale,
  uiText as __uiText,
  useUiLocale as __useUiLocale,
} from '@cp/ui';

/** Same rules as josh (refund_banks CHECK + DTO): code A–Z 0–9 _, 2–10; each length 6–20, at most 5. */
const CODE = /^[A-Z0-9_]{2,10}$/;

function parseDigits(text: string): number[] | null {
  const parts = text.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > 5) return null;
  const nums = parts.map(Number);
  return nums.every((n) => Number.isInteger(n) && n >= 6 && n <= 20) ? nums : null;
}

function errorMessage(e: unknown): string {
  const r = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = r?.response?.data?.message;
  return (Array.isArray(m) ? m.join('\n') : m) ?? r?.message ?? __uiText('ทำรายการไม่สำเร็จ');
}

const lang = () => (getUiLocale() === 'en' ? 'en' : 'th');

type Form = {
  /** null = adding a new bank. */
  editing: string | null;
  code: string;
  nameTh: string;
  nameEn: string;
  accountDigits: string;
  sortOrder: string;
  isActive: boolean;
  logoUrl: string | null;
  logo: File | null;
  removeLogo: boolean;
};

const blank = (): Form => ({
  editing: null,
  code: '',
  nameTh: '',
  nameEn: '',
  accountDigits: '10',
  sortOrder: '0',
  isActive: true,
  logoUrl: null,
  logo: null,
  removeLogo: false,
});

const fromBank = (b: RefundBankAdmin): Form => ({
  editing: b.code,
  code: b.code,
  nameTh: b.nameTh,
  nameEn: b.nameEn,
  accountDigits: b.accountDigits.join(', '),
  sortOrder: String(b.sortOrder),
  isActive: b.isActive,
  logoUrl: b.logoUrl,
  logo: null,
  removeLogo: false,
});

function BankLogo({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img src={url} alt={name} className="h-8 w-8 rounded object-contain" />
  ) : (
    <span className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">—</span>
  );
}

export default function RefundBanksAdmin() {
  __useUiLocale();
  const [rows, setRows] = useState<RefundBankAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listRefundBanks(lang());
      setRows(res.data?.data ?? []);
    } catch (e) {
      setRows([]);
      alert(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const digits = form ? parseDigits(form.accountDigits) : null;
  const valid =
    !!form &&
    (form.editing !== null || CODE.test(form.code)) &&
    !!form.nameTh.trim() &&
    !!form.nameEn.trim() &&
    !!digits &&
    Number.isInteger(Number(form.sortOrder));

  const save = async () => {
    if (!form || !valid || !digits) return;
    const input: RefundBankInput = {
      nameTh: form.nameTh.trim(),
      nameEn: form.nameEn.trim(),
      accountDigits: digits,
      sortOrder: Number(form.sortOrder),
      isActive: form.isActive,
    };
    setBusy(true);
    try {
      if (form.editing) {
        await updateRefundBank(form.editing, { ...input, removeLogo: form.removeLogo, logo: form.logo }, lang());
      } else {
        await createRefundBank({ code: form.code, ...input, ...(form.logo ? { logo: form.logo } : {}) }, lang());
      }
      setForm(null);
      await load();
    } catch (e) {
      alert(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<RefundBankAdmin>[] = [
    { key: 'logoUrl', label: __uiText('โลโก้'), render: (v, b) => <BankLogo url={v as string | null} name={b.nameEn} /> },
    { key: 'code', label: __uiText('รหัส'), render: (v) => <span className="font-mono">{String(v)}</span> },
    { key: 'nameTh', label: __uiText('ชื่อไทย') },
    { key: 'nameEn', label: __uiText('ชื่ออังกฤษ') },
    { key: 'accountDigits', label: __uiText('ความยาวเลขบัญชี'), render: (v) => (v as number[]).join(', ') },
    { key: 'sortOrder', label: __uiText('ลำดับ'), align: 'right' },
    {
      key: 'isActive',
      label: __uiText('สถานะ'),
      render: (v) => (
        <Chip tone={v ? 'ok' : 'muted'} dot>
          {v ? __uiText('เปิดใช้งาน') : __uiText('ปิดใช้งาน')}
        </Chip>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_v, b) => (
        <CpButton size="sm" variant="ghost" onClick={() => setForm(fromBank(b))}>
          {__uiText('แก้ไข')}
        </CpButton>
      ),
    },
  ];

  const input = 'mt-1 block w-full rounded border px-2 py-1 text-sm disabled:bg-gray-100';

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader
        title={__uiText('ธนาคารสำหรับคืนเงิน')}
        subtitle={__uiText('ธนาคารที่ลูกค้าเลือกรับเงินคืนแบบโอนเข้าบัญชีได้ ปิดใช้งานแทนการลบ')}
      >
        <CpButton icon="refresh" onClick={() => void load()}>{__uiText('รีเฟรช')}</CpButton>
        <CpButton onClick={() => setForm(blank())}>{__uiText('เพิ่มธนาคาร')}</CpButton>
      </AdminListHeader>

      <Table
        columns={columns}
        data={rows}
        idKey="code"
        currentPage={1}
        totalPages={1}
        onPageChange={() => undefined}
        loading={loading}
        emptyTitle={__uiText('ยังไม่มีธนาคาร')}
        emptyDescription={__uiText('กดเพิ่มธนาคารเพื่อเริ่มต้น')}
      />

      {form && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-800">
                {form.editing ? __uiText('แก้ไขธนาคาร') : __uiText('เพิ่มธนาคาร')}
              </h2>
              <button type="button" className="text-sm text-gray-500 hover:text-gray-800" onClick={() => setForm(null)}>
                {__uiText('ปิด')}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm text-gray-700">
              <label className="text-xs">
                {__uiText('รหัสธนาคาร')}
                <input
                  name="code"
                  className={`${input} font-mono uppercase`}
                  value={form.code}
                  disabled={form.editing !== null}
                  maxLength={10}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                />
                <span className="text-[11px] text-gray-400">{__uiText('A–Z, 0–9, _ ยาว 2–10 ตัว แก้ภายหลังไม่ได้')}</span>
              </label>
              <label className="text-xs">
                {__uiText('ลำดับ')}
                <input
                  name="sortOrder"
                  type="number"
                  className={input}
                  value={form.sortOrder}
                  onChange={(e) => set('sortOrder', e.target.value)}
                />
              </label>
              <label className="text-xs">
                {__uiText('ชื่อไทย')}
                <input name="nameTh" className={input} value={form.nameTh} maxLength={150} onChange={(e) => set('nameTh', e.target.value)} />
              </label>
              <label className="text-xs">
                {__uiText('ชื่ออังกฤษ')}
                <input name="nameEn" className={input} value={form.nameEn} maxLength={150} onChange={(e) => set('nameEn', e.target.value)} />
              </label>
              <label className="col-span-2 text-xs">
                {__uiText('ความยาวเลขบัญชี')}
                <input
                  name="accountDigits"
                  className={input}
                  value={form.accountDigits}
                  onChange={(e) => set('accountDigits', e.target.value)}
                />
                <span className="text-[11px] text-gray-400">{__uiText('จำนวนหลักที่รับ คั่นด้วยจุลภาค เช่น 10 หรือ 12, 15')}</span>
              </label>

              <div className="col-span-2 flex items-center gap-3">
                <BankLogo url={form.removeLogo ? null : form.logoUrl} name={form.nameEn} />
                <label className="text-xs">
                  {__uiText('โลโก้ (png / jpg / webp ไม่เกิน 2 MB)')}
                  <input
                    name="logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="mt-1 block text-sm"
                    onChange={(e) => set('logo', e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {form.editing && form.logoUrl && (
                <label className="col-span-2 flex items-center gap-2 text-xs">
                  <input name="removeLogo" type="checkbox" checked={form.removeLogo} onChange={(e) => set('removeLogo', e.target.checked)} />
                  {__uiText('ลบโลโก้')}
                </label>
              )}
              <label className="col-span-2 flex items-center gap-2 text-xs">
                <input name="isActive" type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
                {__uiText('เปิดให้ลูกค้าเลือก (ปิดแล้วบัญชีเดิมของลูกค้ายังใช้ได้)')}
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t pt-3">
              <CpButton variant="ghost" onClick={() => setForm(null)}>{__uiText('ยกเลิก')}</CpButton>
              <CpButton disabled={busy || !valid} onClick={() => void save()}>{__uiText('บันทึก')}</CpButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

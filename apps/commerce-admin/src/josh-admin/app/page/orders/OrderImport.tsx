import {
  importOrdersCsv,
  relinkAllOrderUsers,
  relinkOrderUsersCsv,
} from '@josh/shared-api';
import React, { useState } from 'react';
import { Button, Icon } from '@cp/ui';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
function FileField({
  label,
  accept = '.csv',
  onChange,
}: {
  label: string;
  accept?: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="block rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-700 focus-within:border-primary">
      <span className="mb-3 flex items-center gap-2 font-medium"><Icon name="cloud_upload" />{label}</span>
      <input
        type="file"
        accept={accept}
        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export default function OrderImport() {
  __useUiLocale();
  const [ordersFile, setOrdersFile] = useState<File | null>(null);
  const [itemsFile, setItemsFile] = useState<File | null>(null);
  const [relinkFile, setRelinkFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'import' | 'relink' | 'relink-all' | null>(
    null,
  );
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const runImport = async () => {
    if (!ordersFile || !itemsFile) {
      alert(__uiText("ต้องเลือกไฟล์ orders และ items (.csv)"));
      return;
    }
    setBusy('import');
    setError('');
    setResult('');
    try {
      const res: any = await importOrdersCsv(ordersFile, itemsFile);
      const data = res?.data ?? res;
      setResult(
        typeof data === 'string'
          ? data
          : JSON.stringify(data, null, 2),
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? err.message ?? __uiMessage("Import ไม่สำเร็จ"),
      );
    } finally {
      setBusy(null);
    }
  };

  const runRelinkCsv = async () => {
    if (!relinkFile) {
      alert(__uiText("เลือกไฟล์ orders CSV สำหรับ relink"));
      return;
    }
    setBusy('relink');
    setError('');
    setResult('');
    try {
      const res: any = await relinkOrderUsersCsv(relinkFile);
      const data = res?.data ?? res;
      setResult(
        __uiMessage('Relink CSV สำเร็จ — relinked: {0}', { '0': data?.relinked ?? data?.data?.relinked ?? '?' }),
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? err.message ?? __uiMessage("Relink ไม่สำเร็จ"),
      );
    } finally {
      setBusy(null);
    }
  };

  const runRelinkAll = async () => {
    if (
      !window.confirm(
        __uiText("Relink ทุก order ตาม customer_code ที่เก็บไว้แล้ว — ยืนยัน?"),
      )
    ) {
      return;
    }
    setBusy('relink-all');
    setError('');
    setResult('');
    try {
      const res: any = await relinkAllOrderUsers();
      const data = res?.data ?? res;
      setResult(
        __uiMessage('Relink all สำเร็จ — relinked: {0}', { '0': data?.relinked ?? data?.data?.relinked ?? '?' }),
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? err.message ?? __uiMessage("Relink all ไม่สำเร็จ"),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <AdminListHeader
        title={__uiText("Order Import")}
        subtitle={__uiText("นำเข้า CSV / เชื่อม user กับออเดอร์ (staff only)")}
      >
        <Link
          to={ADMIN_ROUTES.orders}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          {__uiText("← All Orders")}</Link>
      </AdminListHeader>

      <div className="grid max-w-4xl gap-5">
        <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">
            {__uiText("Import orders + items")}</h2>
          <p className="mb-3 text-xs text-gray-500">
            {__uiText("อัปโหลดไฟล์ orders.csv และ items.csv พร้อมกัน")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FileField label={__uiText("Orders CSV *")} onChange={setOrdersFile} />
            <FileField label={__uiText("Items CSV *")} onChange={setItemsFile} />
          </div>
          <Button
            variant="primary"
            icon="cloud_upload"
            disabled={busy !== null || !ordersFile || !itemsFile}
            className="mt-5"
            onClick={() => void runImport()}
          >
            {busy === 'import' ? __uiText("กำลัง import...") : __uiText("Import CSV")}
          </Button>
        </section>

        <details className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
          <summary className="cursor-pointer text-sm font-semibold text-gray-800">{__uiText('เครื่องมือเชื่อมลูกค้ากับออเดอร์')}</summary>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <section className="rounded-xl border border-gray-100 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">
            {__uiText("Relink users จาก CSV")}</h2>
          <p className="mb-3 text-xs text-gray-500">
            {__uiText("อ่าน customer code จากไฟล์ orders แล้วผูก user ใหม่")}</p>
          <FileField label={__uiText("Orders CSV")} onChange={setRelinkFile} />
          <button
            type="button"
            disabled={busy !== null || !relinkFile}
            className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void runRelinkCsv()}
          >
            {busy === 'relink' ? __uiText("กำลัง relink...") : __uiText("Relink from CSV")}
          </button>
        </section>
        <section className="rounded-xl border border-gray-100 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">
            {__uiText("Relink all (จาก customer_code ใน DB)")}</h2>
          <p className="mb-3 text-xs text-gray-500">
            {__uiText("ไม่ต้องอัปโหลดไฟล์ — ใช้ customer_code ที่บันทึกไว้บน order")}</p>
          <button
            type="button"
            disabled={busy !== null}
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            onClick={() => void runRelinkAll()}
          >
            {busy === 'relink-all' ? __uiText("กำลัง relink...") : __uiText("Relink all orders")}
          </button>
        </section>
          </div>
        </details>

        {error ? (
          <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            {__uiText(error)}
          </p>
        ) : null}
        {result ? (
          <pre className="overflow-x-auto rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900 whitespace-pre-wrap">
            {__uiText(result)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

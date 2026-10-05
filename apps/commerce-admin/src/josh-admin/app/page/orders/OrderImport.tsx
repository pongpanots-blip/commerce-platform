import {
  importOrdersCsv,
  relinkAllOrderUsers,
  relinkOrderUsersCsv,
} from '@josh/shared-api';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

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
    <label className="block text-sm text-gray-700">
      <span className="mb-1 block font-medium">{label}</span>
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
      alert('ต้องเลือกไฟล์ orders และ items (.csv)');
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
        err?.response?.data?.message ?? err.message ?? 'Import ไม่สำเร็จ',
      );
    } finally {
      setBusy(null);
    }
  };

  const runRelinkCsv = async () => {
    if (!relinkFile) {
      alert('เลือกไฟล์ orders CSV สำหรับ relink');
      return;
    }
    setBusy('relink');
    setError('');
    setResult('');
    try {
      const res: any = await relinkOrderUsersCsv(relinkFile);
      const data = res?.data ?? res;
      setResult(
        `Relink CSV สำเร็จ — relinked: ${data?.relinked ?? data?.data?.relinked ?? '?'}`,
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? err.message ?? 'Relink ไม่สำเร็จ',
      );
    } finally {
      setBusy(null);
    }
  };

  const runRelinkAll = async () => {
    if (
      !window.confirm(
        'Relink ทุก order ตาม customer_code ที่เก็บไว้แล้ว — ยืนยัน?',
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
        `Relink all สำเร็จ — relinked: ${data?.relinked ?? data?.data?.relinked ?? '?'}`,
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? err.message ?? 'Relink all ไม่สำเร็จ',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6">
      <AdminListHeader
        title="Order Import"
        subtitle="นำเข้า CSV / เชื่อม user กับออเดอร์ (staff only)"
      >
        <Link
          to={ADMIN_ROUTES.orders}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          ← All Orders
        </Link>
      </AdminListHeader>

      <div className="grid max-w-3xl gap-6">
        <section className="rounded-xl border border-gray-100 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">
            Import orders + items
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            อัปโหลดไฟล์ orders.csv และ items.csv พร้อมกัน
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FileField label="Orders CSV *" onChange={setOrdersFile} />
            <FileField label="Items CSV *" onChange={setItemsFile} />
          </div>
          <button
            type="button"
            disabled={busy !== null}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void runImport()}
          >
            {busy === 'import' ? 'กำลัง import...' : 'Import CSV'}
          </button>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">
            Relink users จาก CSV
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            อ่าน customer code จากไฟล์ orders แล้วผูก user ใหม่
          </p>
          <FileField label="Orders CSV" onChange={setRelinkFile} />
          <button
            type="button"
            disabled={busy !== null}
            className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void runRelinkCsv()}
          >
            {busy === 'relink' ? 'กำลัง relink...' : 'Relink from CSV'}
          </button>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">
            Relink all (จาก customer_code ใน DB)
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            ไม่ต้องอัปโหลดไฟล์ — ใช้ customer_code ที่บันทึกไว้บน order
          </p>
          <button
            type="button"
            disabled={busy !== null}
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            onClick={() => void runRelinkAll()}
          >
            {busy === 'relink-all' ? 'กำลัง relink...' : 'Relink all orders'}
          </button>
        </section>

        {error ? (
          <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {result ? (
          <pre className="overflow-x-auto rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900 whitespace-pre-wrap">
            {result}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

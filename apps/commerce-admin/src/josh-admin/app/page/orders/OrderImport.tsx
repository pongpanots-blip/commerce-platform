import {
  importOrdersCsv,
  relinkAllOrderUsers,
  relinkOrderUsersCsv,
} from '@josh/shared-api';
import React, { useState } from 'react';
import { Alert, Button, Icon, PageHeader, Panel, PanelHead } from '@cp/ui';
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
        __uiText("ผูกลูกค้าใหม่ทุกออเดอร์ตามรหัสลูกค้าที่บันทึกไว้ ยืนยันหรือไม่"),
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
    <div className="cp-management-page space-y-5">
      <PageHeader
        back={{ to: ADMIN_ROUTES.orders, label: "กลับรายการออเดอร์" }}
        title={__uiText("นำเข้าคำสั่งซื้อ")}
        subtitle={__uiText("นำเข้าออเดอร์จากไฟล์ CSV และผูกลูกค้ากับออเดอร์ (สำหรับทีมงาน)")}
      />

      <div className="grid max-w-4xl gap-5">
        <Panel>
          <PanelHead title={__uiText("นำเข้าออเดอร์และรายการสินค้า")} icon="upload_file" />
          <div className="p-5">
            <p className="mb-3 text-xs text-on-surface-variant">
              {__uiText("อัปโหลดไฟล์ orders.csv และ items.csv พร้อมกัน")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FileField label={__uiText("ไฟล์ออเดอร์ (CSV) *")} onChange={setOrdersFile} />
              <FileField label={__uiText("ไฟล์รายการสินค้า (CSV) *")} onChange={setItemsFile} />
            </div>
            <Button
              variant="primary"
              icon="cloud_upload"
              disabled={busy !== null || !ordersFile || !itemsFile}
              className="mt-5"
              onClick={() => void runImport()}
            >
              {busy === 'import' ? __uiText("กำลังนำเข้า…") : __uiText("นำเข้าไฟล์")}
            </Button>
          </div>
        </Panel>

        <details className="rounded-xl border border-secondary-container bg-surface-container-lowest p-4 shadow-card md:p-6">
          <summary className="cursor-pointer text-sm font-semibold text-on-surface">{__uiText('เครื่องมือเชื่อมลูกค้ากับออเดอร์')}</summary>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <section className="rounded-xl border border-secondary-container p-4">
          <h3 className="mb-3 text-sm font-semibold text-on-surface">
            {__uiText("ผูกลูกค้ากับออเดอร์ใหม่จากไฟล์")}</h3>
          <p className="mb-3 text-xs text-on-surface-variant">
            {__uiText("อ่านรหัสลูกค้าจากไฟล์ออเดอร์ แล้วผูกบัญชีลูกค้าให้ใหม่")}</p>
          <FileField label={__uiText("ไฟล์ออเดอร์ (CSV)")} onChange={setRelinkFile} />
          <Button
            disabled={busy !== null || !relinkFile}
            className="mt-4"
            onClick={() => void runRelinkCsv()}
          >
            {busy === 'relink' ? __uiText("กำลังผูกใหม่…") : __uiText("ผูกใหม่จากไฟล์")}
          </Button>
        </section>
        <section className="rounded-xl border border-secondary-container p-4">
          <h3 className="mb-3 text-sm font-semibold text-on-surface">
            {__uiText("ผูกลูกค้าใหม่ทุกออเดอร์")}</h3>
          <p className="mb-3 text-xs text-on-surface-variant">
            {__uiText("ไม่ต้องอัปโหลดไฟล์ ใช้รหัสลูกค้าที่บันทึกไว้บนแต่ละออเดอร์")}</p>
          <Button
            disabled={busy !== null}
            onClick={() => void runRelinkAll()}
          >
            {busy === 'relink-all' ? __uiText("กำลังผูกใหม่…") : __uiText("ผูกใหม่ทุกออเดอร์")}
          </Button>
        </section>
          </div>
        </details>

        {error ? (
          <Alert tone="danger">{__uiText(error)}</Alert>
        ) : null}
        {result ? (
          <Alert tone="ok">
            <pre className="overflow-x-auto text-xs whitespace-pre-wrap">{__uiText(result)}</pre>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

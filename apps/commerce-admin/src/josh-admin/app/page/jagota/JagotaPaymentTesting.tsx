// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { Chip, Empty, TableViewport } from '@cp/ui';
import { getUiLocale as __dateLocale } from '@cp/ui';
import {
  JagotaPendingPayment,
  listJagotaPendingPayments,
  testJagotaPayment,
} from '@josh/shared-api';
import { Button, Input } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Result = { success: boolean } | { error: string };

function formatAmount(amount: string | number): string {
  const n = Number(amount);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(amount);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default function JagotaPaymentTesting() {
  __useUiLocale();
  const [pending, setPending] = useState<JagotaPendingPayment[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [refToken, setRefToken] = useState('');
  const [testingToken, setTestingToken] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const loadPending = async () => {
    setLoadingList(true);
    try {
      const rows = await listJagotaPendingPayments();
      setPending(rows);
    } catch {
      setPending([]);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  const runTest = async (token: string) => {
    const trimmed = token.trim();
    if (!trimmed) return;
    setTestingToken(trimmed);
    setResult(null);
    try {
      const { success } = await testJagotaPayment(trimmed);
      setResult({ success });
      if (success) loadPending();
    } catch (err: any) {
      setResult({ error: err?.response?.data?.message ?? err?.message ?? 'Request failed' });
    } finally {
      setTestingToken(null);
    }
  };

  return (
    <div className="cp-management-page">
      <AdminListHeader
        title={__uiText("ทดสอบชำระเงิน Jagota")}
        subtitle={__uiText("ทดสอบการชำระเงินของ Jagota")}
      />
      <p className="mb-4 max-w-2xl text-sm text-gray-500">
        {__uiText("กดทดสอบเพื่อให้ Jagota ถือว่ารายการ QR นั้นจ่ายเงินแล้ว ใช้ได้เฉพาะระบบทดสอบเท่านั้น ถ้าต่อกับระบบจริง ผลจะไม่สำเร็จเสมอ")}</p>

      <div className="mb-6 max-w-2xl">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">
          {__uiText("รายการ QR ที่ยังไม่จ่าย (ล่าสุด 20 รายการ)")}</h3>
        {loadingList ? (
          <p className="text-sm text-gray-400">{__uiText("กำลังโหลด...")}</p>
        ) : pending.length === 0 ? (
          <Empty>{__uiText("ยังไม่มี QR ที่รอจ่าย — สร้างคำสั่งซื้อที่จ่ายด้วย QR ก่อน หรือกรอกรหัสอ้างอิงเองด้านล่าง")}</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <TableViewport><table className="cp-data-table w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium" scope="col">{__uiText("รหัสอ้างอิง (REF_TOKEN)")}</th>
                  <th className="px-3 py-2 font-medium" scope="col">{__uiText("รหัสคำสั่งซื้อ")}</th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">{__uiText("ยอด")}</th>
                  <th className="px-3 py-2 font-medium" scope="col">{__uiText("สร้างเมื่อ")}</th>
                  <th className="px-3 py-2 font-medium" scope="col" />
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.refToken} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{row.refToken}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">
                      {row.orderId ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAmount(row.amount)} {row.currency}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-gray-500">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        text={testingToken === row.refToken ? __uiText("กำลังทดสอบ...") : __uiText("ทดสอบจ่ายเงิน")}
                        variant="secondary"
                        disabled={testingToken !== null}
                        onClick={() => runTest(row.refToken)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></TableViewport>
          </div>
        )}
      </div>

      <h3 className="mb-2 text-sm font-semibold text-gray-700">
        {__uiText("หรือกรอกรหัสอ้างอิง (REF_TOKEN) เอง")}</h3>
      <div className="flex max-w-xl items-end gap-3">
        <Input
          label={__uiText("รหัสอ้างอิง (REF_TOKEN)")}
          placeholder={__uiText("เช่น 1234567890")}
          value={refToken}
          onChange={(e) => setRefToken(e.target.value)}
          className="flex-1"
        />
        <Button
          text={testingToken === refToken.trim() ? __uiText("กำลังทดสอบ...") : __uiText("ทดสอบจ่ายเงิน")}
          onClick={() => runTest(refToken)}
          disabled={testingToken !== null || !refToken.trim()}
        />
      </div>

      {result && (
        <div role="status" className="mt-4 flex max-w-xl flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          {'error' in result ? (
            <>
              <Chip tone="danger" dot>{__uiText("ผิดพลาด")}</Chip>
              <span className="text-gray-700">{result.error}</span>
            </>
          ) : result.success ? (
            <>
              <Chip tone="ok" dot>{__uiText("สำเร็จ")}</Chip>
              <span className="text-gray-700">{__uiText("รายการนี้ถูกตั้งเป็นจ่ายเงินแล้ว")}</span>
            </>
          ) : (
            <>
              <Chip tone="warn" dot>{__uiText("ไม่สำเร็จ")}</Chip>
              <span className="text-gray-700">{__uiText("ตรวจว่ารหัสอ้างอิงถูกต้อง และระบบต่อกับระบบทดสอบอยู่")}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

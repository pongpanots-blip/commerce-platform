// ui-date-locale: display formatting only; stored dates and request values are unchanged
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
    <div className="p-6">
      <AdminListHeader title={__uiText("Jagota Payment Testing")} />
      <p className="mb-4 max-w-2xl text-sm text-gray-500">
        {__uiText("เรียก ")}<code>{__uiText("payment_test")}</code> {__uiText(" ของ Jagota เพื่อบังคับให้ REF_TOKEN นั้นเป็น paid — ใช้ได้บน staging เท่านั้น ถ้า backend ชี้ไป production จะได้")}{' '}
        <code>{__uiText("success: false")}</code> {__uiText(" เสมอ")}</p>

      <div className="mb-6 max-w-2xl">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">
          {__uiText("รายการ QR ที่ยังไม่จ่าย (ล่าสุด 20 รายการ)")}</h3>
        {loadingList ? (
          <p className="text-sm text-gray-400">{__uiText("กำลังโหลด...")}</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-gray-400">{__uiText("ไม่มีรายการที่ยังไม่จ่าย")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{__uiText("REF_TOKEN")}</th>
                  <th className="px-3 py-2 font-medium">{__uiText("Order ID")}</th>
                  <th className="px-3 py-2 font-medium">{__uiText("ยอด")}</th>
                  <th className="px-3 py-2 font-medium">{__uiText("สร้างเมื่อ")}</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.refToken} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{row.refToken}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {row.orderId ?? '-'}
                    </td>
                    <td className="px-3 py-2">
                      {row.amount} {row.currency}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        text={testingToken === row.refToken ? __uiText("กำลังยิง...") : __uiText("เทส Payment")}
                        variant="secondary"
                        disabled={testingToken !== null}
                        onClick={() => runTest(row.refToken)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h3 className="mb-2 text-sm font-semibold text-gray-700">
        {__uiText("หรือกรอก REF_TOKEN เอง")}</h3>
      <div className="flex max-w-xl items-end gap-3">
        <Input
          label={__uiText("REF_TOKEN")}
          placeholder={__uiText("เช่น 1234567890")}
          value={refToken}
          onChange={(e) => setRefToken(e.target.value)}
          className="flex-1"
        />
        <Button
          text={testingToken === refToken.trim() ? __uiText("กำลังยิง...") : __uiText("เทส Payment")}
          onClick={() => runTest(refToken)}
          disabled={testingToken !== null || !refToken.trim()}
        />
      </div>

      {result && (
        <div className="mt-4 max-w-xl rounded-lg border p-3 text-sm">
          {'error' in result ? (
            <span className="text-red-600">{__uiText("Error: ")}{result.error}</span>
          ) : result.success ? (
            <span className="text-emerald-600">{__uiText("สำเร็จ — REF_TOKEN นี้ถูกตั้งเป็น paid แล้ว")}</span>
          ) : (
            <span className="text-amber-600">
              {__uiText("ไม่สำเร็จ — ตรวจว่า REF_TOKEN ถูกต้อง และ backend ชี้ไป staging")}</span>
          )}
        </div>
      )}
    </div>
  );
}

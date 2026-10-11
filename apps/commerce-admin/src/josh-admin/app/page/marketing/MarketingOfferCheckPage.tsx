// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { Alert, Button, Chip, FormField, Input, KeyValueGrid, PageHeader, Panel, TableEmpty, TableViewport, type Tone } from '@cp/ui';
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  inspectMarketingOffers,
  reactivateMarketingOffer,
  type MarketingOfferInspectResult,
} from '@josh/shared-api';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const OFFER_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'กำลังแสดง', tone: 'ok' },
  dismissed: { label: 'ลูกค้าปิดแล้ว', tone: 'warn' },
  expired: { label: 'หมดอายุ', tone: 'muted' },
};

/**
 * Operator page to diagnose why a scheduled/show_offer popup did or did not
 * appear: paste shop `individual_id` (device) and/or `user_id`, see device→user
 * link, every offer row (incl. dismissed), and what `/active` would return.
 */
export default function MarketingOfferCheckPage() {
  __useUiLocale();
  const [individualId, setIndividualId] = useState(
    'b983c8999ea148dcb156e03f56f7d392',
  );
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MarketingOfferInspectResult | null>(null);

  const runInspect = async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await inspectMarketingOffers({
        individualId: individualId.trim() || undefined,
        userId: userId.trim() || undefined,
      });
      setResult(data);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? String((err as { response?: { data?: { message?: string } } }).response?.data?.message)
          : err instanceof Error
            ? err.message
            : 'โหลดไม่สำเร็จ';
      setError(message || __uiMessage("โหลดไม่สำเร็จ"));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleReactivate = async (offerId: string) => {
    setBusyId(offerId);
    setError('');
    try {
      await reactivateMarketingOffer(offerId);
      await runInspect();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : __uiText("เปิดข้อเสนออีกครั้งไม่สำเร็จ");
      setError(message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <PageHeader
        back={{ to: ADMIN_ROUTES.marketingWorkflows, label: 'ข้อความอัตโนมัติ' }}
        title={__uiText("ตรวจข้อเสนอ")}
        subtitle={__uiText("ตรวจว่าอุปกรณ์หรือผู้ใช้จะเห็นข้อเสนอใดบนร้านค้า")}
      />

      <Panel as="form" onSubmit={(event) => void runInspect(event)} className="flex flex-wrap items-end gap-3 p-4">
        <FormField label={__uiText("รหัสอุปกรณ์จากร้านค้า")} className="min-w-[240px] flex-1">
          <Input
            className="font-mono"
            value={individualId}
            onChange={(event) => setIndividualId(event.target.value)}
            placeholder={__uiText("รหัสอุปกรณ์ที่ร้านค้าส่งมา")}
          />
        </FormField>
        <FormField label={__uiText("รหัสผู้ใช้ (ไม่บังคับ)")} className="min-w-[240px] flex-1">
          <Input
            className="font-mono"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder={__uiText("รหัสผู้ใช้ของลูกค้า")}
          />
        </FormField>
        <Button
          type="submit"
          variant="primary"
          disabled={loading || (!individualId.trim() && !userId.trim())}
        >
          {loading ? __uiText("กำลังตรวจ…") : __uiText("ตรวจ")}
        </Button>
      </Panel>

      {error ? <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert> : null}

      {result ? (
        <div className="flex flex-col gap-4">
          <Panel className="space-y-4 p-4">
            <KeyValueGrid
              cols={2}
              items={[
                {
                  label: __uiText("ผู้ใช้ที่ผูกกับอุปกรณ์นี้"),
                  value: result.device_linked_user_id ?? __uiText("ยังไม่ผูกกับผู้ใช้"),
                  mono: Boolean(result.device_linked_user_id),
                },
                {
                  label: __uiText("ผู้ใช้ที่ใช้ตรวจ"),
                  value: result.resolved_user_id,
                  mono: true,
                },
              ]}
            />
            <div>
              <p className="text-xs font-medium text-gray-500">
                {__uiText("ข้อเสนอที่ร้านค้าจะแสดง ({0})", {"0": result.active_for_shop.length.toLocaleString()})}</p>
              {result.active_for_shop.length === 0 ? (
                <p className="mt-1 text-sm text-warn">
                  {__uiText("ร้านค้าจะไม่แสดงข้อเสนอ ส่วนใหญ่เพราะลูกค้าปิดข้อเสนอทั้งหมดแล้ว หรืออุปกรณ์ยังไม่ผูกกับผู้ใช้")}</p>
              ) : (
                <ul className="mt-1 list-inside list-disc text-sm text-gray-800">
                  {result.active_for_shop.map((offer) => (
                    <li key={offer.id}>
                      <span className="font-medium">{offer.title || __uiText("(ไม่มีหัวข้อ)")}</span>{' '}
                      <span className="font-mono text-xs text-gray-400">{offer.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <TableViewport className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="cp-data-table min-w-full text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium" scope="col">{__uiText("สถานะ")}</th>
                  <th className="px-3 py-2 font-medium" scope="col">{__uiText("หัวข้อ")}</th>
                  <th className="px-3 py-2 font-medium" scope="col">{__uiText("ข้อความอัตโนมัติ")}</th>
                  <th className="px-3 py-2 font-medium" scope="col">{__uiText("สร้างเมื่อ")}</th>
                  <th className="px-3 py-2 font-medium" scope="col">{__uiText("แก้ไขล่าสุด")}</th>
                  <th className="px-3 py-2 font-medium" scope="col"><span className="sr-only">{__uiText("จัดการ")}</span></th>
                </tr>
              </thead>
              <tbody>
                {result.offers.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <TableEmpty title="ไม่พบข้อเสนอของอุปกรณ์หรือผู้ใช้นี้">
                        {__uiText("ตรวจรหัสอีกครั้ง หรือลองใส่รหัสผู้ใช้แทน")}
                      </TableEmpty>
                    </td>
                  </tr>
                ) : (
                  result.offers.map((offer) => {
                    const status = OFFER_STATUS[offer.status];
                    return (
                    <tr key={offer.id} className="border-b border-gray-50">
                      <td className="px-3 py-2">
                        {status ? (
                          <Chip tone={status.tone} statusCode={offer.status} dot>{__uiText(status.label)}</Chip>
                        ) : (
                          <Chip>{offer.status}</Chip>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">
                          {offer.title || '—'}
                        </div>
                        <div className="font-mono text-[11px] text-gray-400">{offer.id}</div>
                      </td>
                      <td className="px-3 py-2">
                        {offer.workflow_id ? (
                          <Link
                            to={ADMIN_ROUTES.marketingWorkflowEdit(offer.workflow_id)}
                            className="font-mono text-[11px] text-primary hover:underline"
                          >
                            {offer.workflow_id.slice(0, 8)}…
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {new Date(offer.created_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {new Date(offer.updated_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {offer.status !== 'active' ? (
                          <Button
                            size="sm"
                            disabled={busyId === offer.id}
                            onClick={() => void handleReactivate(offer.id)}
                          >
                            {busyId === offer.id ? '…' : __uiText("แสดงข้อเสนออีกครั้ง")}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </TableViewport>
        </div>
      ) : null}
    </div>
  );
}

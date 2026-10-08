// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { FormEvent, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  inspectMarketingOffers,
  reactivateMarketingOffer,
  type MarketingOfferInspectResult,
} from '@josh/shared-api';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
import { PageHeader } from '@cp/ui';
const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none';

const STATUS_CLASS: Record<string, string> = {
  active: 'text-green-600 font-semibold',
  dismissed: 'text-amber-600',
  expired: 'text-gray-400',
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
  const individualIdInputId = useId();
  const userIdInputId = useId();

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
        err instanceof Error ? err.message : 'reactivate ไม่สำเร็จ';
      setError(message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <PageHeader
        back={{ to: ADMIN_ROUTES.marketingWorkflows, label: 'เวิร์กโฟลว์การตลาด' }}
        title={__uiText("Offer Check")}
        subtitle={<>
          {__uiText("เช็กว่า device มีลิงก์ user หรือยัง, offer ถูก dismiss ไปหรือยัง, และ shop จะเห็นอะไรจาก")}{' '}
          <code className="text-xs">{__uiText("GET /marketing-offers/active")}</code>
        </>}
      />

      <form
        onSubmit={(event) => void runInspect(event)}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <div className="min-w-[240px] flex-1">
          <label htmlFor={individualIdInputId} className="mb-1 block text-xs font-medium text-gray-500">
            {__uiText("รหัสอุปกรณ์ (individual_id) จาก shop")}</label>
          <input
            id={individualIdInputId}
            className={INPUT_CLASS}
            value={individualId}
            onChange={(event) => setIndividualId(event.target.value)}
            placeholder={__uiText("จาก getDeviceId() / URL ?individual_id=")}
          />
        </div>
        <div className="min-w-[240px] flex-1">
          <label htmlFor={userIdInputId} className="mb-1 block text-xs font-medium text-gray-500">
            {__uiText("รหัสผู้ใช้ (user_id) — ไม่บังคับ")}</label>
          <input
            id={userIdInputId}
            className={INPUT_CLASS}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder={__uiText("UUID ของ user")}
          />
        </div>
        <button
          type="submit"
          disabled={loading || (!individualId.trim() && !userId.trim())}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? __uiText("กำลังเช็ก…") : __uiText("เช็ก")}
        </button>
      </form>

      {error ? <p className="text-sm text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p> : null}

      {result ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-gray-500">{__uiText("device_linked_user_id")}</p>
              <p className="mt-0.5 break-all font-mono text-xs text-gray-800">
                {result.device_linked_user_id ?? __uiText("— (ยังไม่ลิงก์)")}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">{__uiText("resolved_user_id")}</p>
              <p className="mt-0.5 break-all font-mono text-xs text-gray-800">
                {result.resolved_user_id ?? '—'}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs font-medium text-gray-500">
                {__uiText("active_for_shop (")}{result.active_for_shop.length}{__uiText(") — สิ่งที่ popup จะเห็น")}</p>
              {result.active_for_shop.length === 0 ? (
                <p className="mt-1 text-amber-600">
                  {__uiText("ว่าง = shop ไม่เด้ง (มักเพราะทุก offer เป็น dismissed หรือยังไม่ลิงก์ user)")}</p>
              ) : (
                <ul className="mt-1 list-inside list-disc text-gray-800">
                  {result.active_for_shop.map((offer) => (
                    <li key={offer.id}>
                      <span className="font-medium">{offer.title || __uiText("(ไม่มี title)")}</span>{' '}
                      <span className="font-mono text-xs text-gray-400">{offer.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{__uiText("Status")}</th>
                  <th className="px-3 py-2 font-medium">{__uiText("Title")}</th>
                  <th className="px-3 py-2 font-medium">{__uiText("Workflow")}</th>
                  <th className="px-3 py-2 font-medium">{__uiText("Created")}</th>
                  <th className="px-3 py-2 font-medium">{__uiText("Updated")}</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {result.offers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                      {__uiText("ไม่พบ offer สำหรับ device/user นี้")}</td>
                  </tr>
                ) : (
                  result.offers.map((offer) => (
                    <tr key={offer.id} className="border-b border-gray-50">
                      <td className={`px-3 py-2 text-xs ${STATUS_CLASS[offer.status] ?? ''}`}>
                        {offer.status}
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
                          <button
                            type="button"
                            disabled={busyId === offer.id}
                            onClick={() => void handleReactivate(offer.id)}
                            className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {busyId === offer.id ? '…' : __uiText("Reactivate")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

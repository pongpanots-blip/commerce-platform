import { useEffect, useId, useState } from 'react';
import {
  MARKETING_TEMPLATE_VARIABLES,
  getGlobalFrequencyCap,
  getTemplateVarFallbacks,
  updateGlobalFrequencyCap,
  updateTemplateVarFallbacks,
  type GlobalFrequencyCapSetting,
  type TemplateVarFallbackSetting,
} from '@josh/shared-api';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
import { PageHeader } from '@cp/ui';
const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none';

const SAVE_BUTTON_CLASS =
  'rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50';

/** Admin-editable template vars — `today` is excluded since it's auto-computed. */
const TEMPLATE_VAR_FALLBACK_KEYS = [
  'user_name',
  'user_first_name',
  'user_last_name',
  'user_email',
  'user_phone',
  'user_custype',
  'company_name',
  'company_phone',
  'company_credit_limit',
  'cuisine_name',
];

const templateVarLabel = (key: string): string =>
  __uiText(MARKETING_TEMPLATE_VARIABLES.find((item) => item.key === key)?.label ?? key);

export default function MarketingSettingsPage() {
  __useUiLocale();
  const [capLoading, setCapLoading] = useState(true);
  const [capSaving, setCapSaving] = useState(false);
  const [capResult, setCapResult] = useState<string>('');
  const [cap, setCap] = useState<GlobalFrequencyCapSetting>({
    enabled: false,
    maxPerUserPerDay: 5,
  });

  const [fallbacksLoading, setFallbacksLoading] = useState(true);
  const [fallbacksSaving, setFallbacksSaving] = useState(false);
  const [fallbacksResult, setFallbacksResult] = useState<string>('');
  const [fallbacks, setFallbacks] = useState<TemplateVarFallbackSetting>({});
  const maxPerUserInputId = useId();

  useEffect(() => {
    getGlobalFrequencyCap()
      .then(setCap)
      .catch(() => undefined)
      .finally(() => setCapLoading(false));
    getTemplateVarFallbacks()
      .then(setFallbacks)
      .catch(() => undefined)
      .finally(() => setFallbacksLoading(false));
  }, []);

  const saveCap = async () => {
    setCapSaving(true);
    setCapResult('');
    try {
      const saved = await updateGlobalFrequencyCap(cap);
      setCap(saved);
      setCapResult('บันทึกสำเร็จ');
    } catch (err: any) {
      setCapResult(err?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setCapSaving(false);
    }
  };

  const saveFallbacks = async () => {
    setFallbacksSaving(true);
    setFallbacksResult('');
    try {
      const saved = await updateTemplateVarFallbacks(fallbacks);
      setFallbacks(saved);
      setFallbacksResult('บันทึกสำเร็จ');
    } catch (err: any) {
      setFallbacksResult(err?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setFallbacksSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <PageHeader
        back={{ to: ADMIN_ROUTES.marketingWorkflows, label: 'เวิร์กโฟลว์การตลาด' }}
        title={__uiText("Marketing Settings")}
        subtitle={__uiText("ตั้งค่าที่มีผลกับ marketing ทุก workflow — ไม่ผูกกับ workflow ใดเป็นการเฉพาะ")}
      />

      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <div>
          <h2 className="font-bold text-gray-800">{__uiText("Global Frequency Cap")}</h2>
          <p className="mt-1 text-xs text-gray-500">
            {__uiText("จำกัดจำนวนข้อความ marketing (notify + show_offer รวมกัน) ที่ผู้ใช้ 1 คนจะได้รับต่อวัน — นับรวมทุก workflow ไม่ใช่แค่ cooldown ของแคมเปญเดียว")}</p>
        </div>
        {capLoading ? (
          <p className="text-sm text-gray-400">{__uiText("กำลังโหลด...")}</p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={cap.enabled}
                onChange={(event) => setCap((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              {__uiText("เปิดใช้ Global Frequency Cap")}</label>
            <div className="max-w-xs">
              <label htmlFor={maxPerUserInputId} className="mb-1 block text-xs font-medium text-gray-500">
                {__uiText("จำนวนข้อความสูงสุดต่อคนต่อวัน")}</label>
              <input
                id={maxPerUserInputId}
                type="number"
                min={1}
                className={INPUT_CLASS}
                value={cap.maxPerUserPerDay}
                onChange={(event) =>
                  setCap((prev) => ({
                    ...prev,
                    maxPerUserPerDay: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={capSaving}
                onClick={saveCap}
                className={SAVE_BUTTON_CLASS}
              >
                {capSaving ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
              </button>
              {capResult && <p className="text-xs text-gray-500">{capResult}</p>}
            </div>
          </>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <div>
          <h2 className="font-bold text-gray-800">{__uiText("Template Variable Fallbacks")}</h2>
          <p className="mt-1 text-xs text-gray-500">
            {__uiText("ข้อความสำรองที่ใช้แทน เช่น ")}{__uiText("{{user_name}}")} {__uiText(" เมื่อไม่มีค่าจริง (เช่น guest checkout หรือไม่มีข้อมูลบริษัท)")}</p>
        </div>
        {fallbacksLoading ? (
          <p className="text-sm text-gray-400">{__uiText("กำลังโหลด...")}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {TEMPLATE_VAR_FALLBACK_KEYS.map((key) => (
                <div key={key}>
                  <label htmlFor={`fallback-${key}`} className="mb-1 block text-xs font-medium text-gray-500">
                    {templateVarLabel(key)}{' '}
                    <span className="font-mono text-[10px] text-gray-300">{`{{${key}}}`}</span>
                  </label>
                  <input
                    id={`fallback-${key}`}
                    type="text"
                    className={INPUT_CLASS}
                    value={fallbacks[key] ?? ''}
                    onChange={(event) =>
                      setFallbacks((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={fallbacksSaving}
                onClick={saveFallbacks}
                className={SAVE_BUTTON_CLASS}
              >
                {fallbacksSaving ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
              </button>
              {fallbacksResult && <p className="text-xs text-gray-500">{fallbacksResult}</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

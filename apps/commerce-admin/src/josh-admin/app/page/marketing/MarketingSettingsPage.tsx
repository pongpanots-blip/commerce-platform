import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
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
  MARKETING_TEMPLATE_VARIABLES.find((item) => item.key === key)?.label ?? key;

export default function MarketingSettingsPage() {
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
      <div>
        <Link to={ADMIN_ROUTES.marketingWorkflows} className="text-xs text-primary hover:underline">
          &larr; Marketing Workflows
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Marketing Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          ตั้งค่าที่มีผลกับ marketing ทุก workflow — ไม่ผูกกับ workflow ใดเป็นการเฉพาะ
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <div>
          <h2 className="font-bold text-gray-800">Global Frequency Cap</h2>
          <p className="mt-1 text-xs text-gray-500">
            จำกัดจำนวนข้อความ marketing (notify + show_offer รวมกัน) ที่ผู้ใช้ 1 คนจะได้รับต่อวัน
            — นับรวมทุก workflow ไม่ใช่แค่ cooldown ของแคมเปญเดียว
          </p>
        </div>
        {capLoading ? (
          <p className="text-sm text-gray-400">กำลังโหลด...</p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={cap.enabled}
                onChange={(event) => setCap((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              เปิดใช้ Global Frequency Cap
            </label>
            <div className="max-w-xs">
              <label htmlFor={maxPerUserInputId} className="mb-1 block text-xs font-medium text-gray-500">
                จำนวนข้อความสูงสุดต่อคนต่อวัน
              </label>
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
                {capSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              {capResult && <p className="text-xs text-gray-500">{capResult}</p>}
            </div>
          </>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <div>
          <h2 className="font-bold text-gray-800">Template Variable Fallbacks</h2>
          <p className="mt-1 text-xs text-gray-500">
            ข้อความสำรองที่ใช้แทน เช่น {'{{user_name}}'} เมื่อไม่มีค่าจริง (เช่น guest checkout
            หรือไม่มีข้อมูลบริษัท)
          </p>
        </div>
        {fallbacksLoading ? (
          <p className="text-sm text-gray-400">กำลังโหลด...</p>
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
                {fallbacksSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              {fallbacksResult && <p className="text-xs text-gray-500">{fallbacksResult}</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

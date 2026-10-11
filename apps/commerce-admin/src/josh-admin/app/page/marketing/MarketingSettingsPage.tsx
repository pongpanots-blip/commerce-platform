import { useEffect, useState } from 'react';
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
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Button, Checkbox, FormField, Hint, Input, Loading, PageHeader, Panel, PanelHead } from "@cp/ui";

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
    <div className="cp-management-page space-y-6">
      <PageHeader
        back={{ to: ADMIN_ROUTES.marketingWorkflows, label: 'ข้อความอัตโนมัติ' }}
        title={__uiText("ตั้งค่าการตลาด")}
        subtitle={__uiText("ค่าที่มีผลกับข้อความอัตโนมัติทั้งหมด")}
      />

      <Panel>
        <PanelHead
          title={__uiText("จำกัดจำนวนข้อความต่อวัน")}
          sub={__uiText("นับรวมข้อความและข้อเสนอจากข้อความอัตโนมัติทุกชุดที่ลูกค้า 1 คนได้รับใน 1 วัน")}
        />
        <div className="space-y-4 p-5">
          {capLoading ? (
            <Loading />
          ) : (
            <>
              <Checkbox
                label={__uiText("เปิดใช้การจำกัดจำนวนข้อความต่อวัน")}
                checked={cap.enabled}
                onChange={(event) => setCap((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              <FormField label={__uiText("จำนวนข้อความสูงสุดต่อคนต่อวัน")} className="max-w-xs">
                <Input
                  type="number"
                  min={1}
                  className="text-right tabular-nums"
                  value={cap.maxPerUserPerDay}
                  onChange={(event) =>
                    setCap((prev) => ({
                      ...prev,
                      maxPerUserPerDay: Math.max(1, Number(event.target.value) || 1),
                    }))
                  }
                />
              </FormField>
              <div className="flex items-center gap-3">
                <Button variant="primary" disabled={capSaving} onClick={saveCap}>
                  {capSaving ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
                </Button>
                {capResult && <Hint>{capResult}</Hint>}
              </div>
            </>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHead
          title={__uiText("คำแทนเมื่อไม่มีข้อมูลลูกค้า")}
          sub={__uiText("คำที่ใส่แทนช่องข้อมูลในข้อความ เมื่อลูกค้ายังไม่ได้ให้ข้อมูลนั้น เช่น ยังไม่สมัครสมาชิกหรือไม่มีข้อมูลบริษัท")}
        />
        <div className="space-y-4 p-5">
          {fallbacksLoading ? (
            <Loading />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {TEMPLATE_VAR_FALLBACK_KEYS.map((key) => (
                  <FormField
                    key={key}
                    label={
                      <>
                        {templateVarLabel(key)}{' '}
                        <span className="font-mono text-[10px] text-outline">{`{{${key}}}`}</span>
                      </>
                    }
                  >
                    <Input
                      type="text"
                      value={fallbacks[key] ?? ''}
                      onChange={(event) =>
                        setFallbacks((prev) => ({ ...prev, [key]: event.target.value }))
                      }
                    />
                  </FormField>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Button variant="primary" disabled={fallbacksSaving} onClick={saveFallbacks}>
                  {fallbacksSaving ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
                </Button>
                {fallbacksResult && <Hint>{fallbacksResult}</Hint>}
              </div>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

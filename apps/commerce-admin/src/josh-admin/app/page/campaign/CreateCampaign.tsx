import { createCampaign } from '@josh/shared-api';
import { DateTimeRangeInput, Input } from '@josh/shared-ui-web';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { Section } from '../coupon/CouponCoreForm';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import { getErrorMessage } from '../promotion-common';
import {
  buildCreateCampaignPayload,
  emptyCampaignForm,
  validateCampaignForm,
  type CampaignForm,
  type CampaignFormErrors,
} from './campaign.helpers';

/** Name + dates only — the promotions, coupons and page are added from the campaign's own page. */
// ui-copy-migration: only literal UI copy and notification templates
import { toast, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export default function CreateCampaign() {
  __useUiLocale();
  const navigate = useNavigate();
  const [form, setForm] = useState<CampaignForm>(emptyCampaignForm);
  const [errors, setErrors] = useState<CampaignFormErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const dateLabelId = useId();
  const datesErrorId = useId();

  const patch = (partial: Partial<CampaignForm>) => setForm((current) => ({ ...current, ...partial }));

  const handleSave = async () => {
    if (saving) return false;
    const found = validateCampaignForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setSaveError(__uiMessage("กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง — ตรวจช่องที่ขึ้นสีแดง"));
      return false;
    }
    setSaveError('');
    setSaving(true);
    try {
      const created = await createCampaign(buildCreateCampaignPayload(form));
      toast('บันทึกแคมเปญแล้ว', { label: 'ขั้นถัดไป: เพิ่มโปรหรือคูปอง', href: ADMIN_ROUTES.campaignDetail(created.id) });
      navigate(ADMIN_ROUTES.campaignDetail(created.id));
      return true;
    } catch (err) {
      setSaveError(getErrorMessage(err, 'สร้าง Campaign ไม่สำเร็จ'));
      setSaving(false);
      return false;
    }
    return false;
  };

  return (
    <AdminInsertLayout
      title={__uiText("สร้างแคมเปญ")}
      subtitle={__uiText("ตั้งชื่อและช่วงเวลาที่โปรนี้ใช้ได้ โปรและคูปองเพิ่มในหน้าถัดไป")}
      backPath={ADMIN_ROUTES.campaigns}
      saving={saving}
      saveLabel="บันทึกแคมเปญ"
      steps={['ตั้งชื่อแคมเปญ', 'เลือกวันเริ่มและวันสิ้นสุด', 'บันทึก แล้วไปเพิ่มโปรในหน้าถัดไป']}
      onSave={() => handleSave()}
    >
      <CouponFormErrorBanner error={saveError} />
      <Section title={__uiText("ข้อมูล Campaign")}>
        <Input
          label={__uiText("ชื่อแคมเปญ")}
          required
          hint={__uiText("ชื่อที่ทีมและลูกค้าเข้าใจ เช่น ลดราคาขนมปังสิ้นเดือน")}
          value={form.name}
          error={errors.name}
          aria-invalid={!!errors.name}
          placeholder={__uiText("ลดราคาขนมปังสิ้นเดือน")}
          onChange={(event) => patch({ name: event.target.value })}
        />
        <div role="group" aria-labelledby={dateLabelId} aria-describedby={errors.dates ? datesErrorId : undefined}>
          <p id={dateLabelId} className="mb-1 text-sm text-ink-secondary">
            {__uiText("ระยะเวลา")}<span className="text-alert"> *</span>
          </p>
          <DateTimeRangeInput
            startValue={form.startAt}
            endValue={form.endAt}
            onStartChange={(value) => patch({ startAt: value })}
            onEndChange={(value) => patch({ endAt: value })}
          />
          {errors.dates && (
            <p id={datesErrorId} className="mt-1 text-sm text-alert">
              {(typeof (errors.dates) === 'string' ? __uiText(errors.dates) : errors.dates)}
            </p>
          )}
        </div>
      </Section>
    </AdminInsertLayout>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

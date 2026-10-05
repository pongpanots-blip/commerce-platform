import {
  createUserSegment,
  type UserSegmentRuleType,
} from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { readReturnTo, withRestoreDraftMarker } from '../../utils/return-to';
import SegmentRuleCardFields from './SegmentRuleCardFields';
import {
  EMPTY_RULE_FORM,
  formToRuleConfig,
  generateSegmentSlug,
  getSegmentCard,
  isLiveSegment,
  randomSlugSuffix,
  validateRuleForm,
} from './segment-rule.helpers';

const CreateSegment = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Set when this page was reached from a coupon form's "+ สร้าง segment ใหม่" link — send the
  // admin back there instead of the segment list on save/cancel.
  const returnTo = readReturnTo(searchParams);
  // The `restoreDraft` marker only ever belongs on this specific navigation (back/cancel or a
  // successful save) — never on `returnTo` itself, so a plain revisit of the coupon page never
  // triggers a restore. See return-to.ts and coupon-form-draft.helpers.ts.
  const returnDestination = returnTo ? withRestoreDraftMarker(returnTo) : ADMIN_ROUTES.segments;
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugSuffix] = useState(() => randomSlugSuffix());
  const [form, setForm] = useState({
    slug: '',
    name: '',
    description: '',
    rule_type: 'cuisine' as UserSegmentRuleType,
    is_active: true,
  });
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE_FORM);

  // Auto-generate the slug from the name until the admin edits it by hand.
  useEffect(() => {
    if (slugTouched) return;
    setForm((f) => ({ ...f, slug: generateSegmentSlug(f.name, slugSuffix) }));
  }, [form.name, slugTouched, slugSuffix]);

  const handleRuleTypeChange = (rule_type: UserSegmentRuleType) => {
    setForm((f) => ({ ...f, rule_type }));
    setRuleForm(EMPTY_RULE_FORM);
  };

  const handleSubmit = async () => {
    if (!form.slug.trim() || !form.name.trim()) {
      alert('กรุณากรอกชื่อ Segment');
      return;
    }

    // A legacy `cuisine_parent` type never gets created again — the cuisine card always
    // saves as `cuisine`, with cuisine_ids/parent_ids both living in one rule_config.
    const card = getSegmentCard(form.rule_type);
    const effectiveRuleType: UserSegmentRuleType = card === 'cuisine' ? 'cuisine' : form.rule_type;

    const ruleError = validateRuleForm(effectiveRuleType, ruleForm);
    if (ruleError) {
      alert(ruleError);
      return;
    }

    setSaving(true);
    try {
      const response = await createUserSegment({
        slug: form.slug.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        rule_type: effectiveRuleType,
        rule_config: formToRuleConfig(effectiveRuleType, ruleForm),
        is_active: form.is_active,
      });

      if (response.status >= 200 && response.status < 300) {
        navigate(returnDestination);
      }
    } catch {
      alert('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title="เพิ่ม User Segment"
      subtitle="สร้างกลุ่มลูกค้าใหม่ด้วย rule ที่กำหนดเอง"
      backPath={returnDestination}
      saving={saving}
      onSave={handleSubmit}
    >
      <Input
        label="ชื่อ Segment *"
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />
      <Input
        label="คำอธิบาย (ไม่บังคับ)"
        value={form.description}
        onChange={(event) => setForm({ ...form, description: event.target.value })}
      />

      <SegmentRuleCardFields
        ruleType={form.rule_type}
        ruleForm={ruleForm}
        onRuleTypeChange={handleRuleTypeChange}
        onRuleFormChange={setRuleForm}
      />

      <details className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          ตั้งค่าขั้นสูง
        </summary>
        <div className="mt-3 space-y-4">
          <Input
            label="Slug (ตัวระบุ URL)"
            value={form.slug}
            onChange={(event) => {
              setSlugTouched(true);
              setForm({
                ...form,
                slug: event.target.value.toLowerCase().replace(/\s+/g, '-'),
              });
            }}
            placeholder="kebab-case เช่น vip-customers"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
            />
            เปิดใช้งาน Segment นี้ (Active)
          </label>
        </div>
      </details>

      {!isLiveSegment(form.rule_type) && (
        <p className="text-xs text-gray-500">
          ระบบจะคำนวณรายชื่อครั้งเดียวตอนบันทึก แล้วล็อกไว้ — แก้ไขเงื่อนไขภายหลังไม่ได้
        </p>
      )}
    </AdminInsertLayout>
  );
};

export default CreateSegment;

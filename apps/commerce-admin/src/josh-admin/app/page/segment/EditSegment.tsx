// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
import {
  getUserSegmentById,
  previewUserSegmentCount,
  updateUserSegment,
  type UserSegmentRuleType,
} from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { LoadError } from '../../components/LoadError';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { readReturnTo, withRestoreDraftMarker } from '../../utils/return-to';
import SegmentRuleConfigFields from './SegmentRuleConfigFields';
import {
  EMPTY_RULE_FORM,
  formToRuleConfig,
  getRuleTypeLabel,
  isLiveSegment,
  ruleConfigToForm,
  summarizeRuleConfig,
  validateRuleForm,
} from './segment-rule.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const EditSegment = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Set when this page was reached from a coupon form's "แก้ไข segment ขั้นสูง" link — send the
  // admin back there instead of the segment list on save/cancel.
  const returnTo = readReturnTo(searchParams);
  // The `restoreDraft` marker only ever belongs on this specific navigation (back/cancel or a
  // successful save) — never on `returnTo` itself. See return-to.ts and coupon-form-draft.helpers.ts.
  const returnDestination = returnTo ? withRestoreDraftMarker(returnTo) : ADMIN_ROUTES.segments;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState('');
  const [savedRuleConfig, setSavedRuleConfig] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState({
    name: '',
    description: '',
    rule_type: 'member' as UserSegmentRuleType,
    is_active: true,
  });
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE_FORM);

  // Frozen segments (everything except guest/first_visit/member/staff with no definition) never recompute —
  // membership was locked at `frozen_at`. `locked` is fixed from what the segment was on load;
  // it never flips just because the admin edits the (now read-only) rule_type in the form.
  const [locked, setLocked] = useState(false);
  const [frozenAt, setFrozenAt] = useState<string | null>(null);
  const [lockedMemberCount, setLockedMemberCount] = useState<number | null>(null);
  const [freezing, setFreezing] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    let active = true;
    getUserSegmentById(id)
      .then(async (segment) => {
        if (!active) return;
        if (!segment) { setLoadError(__uiMessage('ไม่พบกลุ่มลูกค้านี้')); return; }
        setSlug(segment.slug);
        setForm({
          name: segment.name,
          description: segment.description ?? '',
          rule_type: segment.rule_type,
          is_active: segment.is_active,
        });
        setSavedRuleConfig(segment.rule_config ?? {});
        setRuleForm(ruleConfigToForm(segment.rule_type, segment.rule_config ?? {}));

        const isLive = isLiveSegment(segment.rule_type, segment.definition);
        setLocked(!isLive);
        if (isLive) return;

        setFrozenAt(segment.frozen_at);
        setLockedMemberCount(segment.member_count);
        // Legacy segment, never previewed since the freeze-on-read change — one call freezes
        // it (backend), then re-fetch to pick up the now-set frozen_at/member_count.
        if (segment.frozen_at === null) {
          setFreezing(true);
          try {
            await previewUserSegmentCount(id);
            const refreshed = await getUserSegmentById(id);
            if (active && refreshed) {
              setFrozenAt(refreshed.frozen_at);
              setLockedMemberCount(refreshed.member_count);
            }
          } catch {
            // ponytail: leave count as "—" on failure — nothing to retry from this page.
          } finally {
            if (active) setFreezing(false);
          }
        }
      })
      .catch((error: unknown) => { if (active) setLoadError(error); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, reload]);

  const handleSubmit = async () => {
    if (!id || !form.name.trim()) {
      alert(__uiText("กรุณากรอกชื่อ"));
      return false;
    }

    let payload: Parameters<typeof updateUserSegment>[1] = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      is_active: form.is_active,
    };

    if (!locked) {
      // Live segment — rule_type is locked in the UI (see below), so it's always still
      // guest/first_visit/member/staff here; only rule_config can have changed.
      const ruleError = validateRuleForm(form.rule_type, ruleForm);
      if (ruleError) {
        alert(ruleError);
        return false;
      }

      payload = {
        ...payload,
        rule_type: form.rule_type,
        rule_config: formToRuleConfig(form.rule_type, ruleForm),
      };
    }

    setSaving(true);
    try {
      const response = await updateUserSegment(id, payload);

      if (response.status >= 200 && response.status < 300) {
        navigate(returnDestination);
        return true;
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      alert(msg ?? __uiText("เกิดข้อผิดพลาดในการบันทึก"));
      return false;
    } finally {
      setSaving(false);
    }
    return false;
  };

  if (loadError) return <LoadError title={__uiText('แก้ไขกลุ่มลูกค้า')} error={loadError} onRetry={() => { setLoadError(null); setLoading(true); setReload(value => value + 1); }} />;
  if (loading) {
    return <div className="cp-management-page text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  return (
    <AdminInsertLayout
      title={__uiText("แก้ไข User Segment")}
      subtitle={__uiText("slug: {0}", {"0": slug})}
      backPath={returnDestination}
      saving={saving}
      onSave={handleSubmit}
    >
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium text-gray-800">
              {getRuleTypeLabel(form.rule_type)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {__uiText("Config ปัจจุบัน:")}{' '}
              {summarizeRuleConfig(form.rule_type, savedRuleConfig)}
            </div>
            {locked ? (
              <>
                <div className="mt-1 text-xs text-gray-400">
                  {__uiText("ล็อกรายชื่อเมื่อ")}{' '}
                  {frozenAt
                    ? new Date(frozenAt).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))
                    : freezing
                      ? __uiText("กำลังคำนวณ...")
                      : '—'}
                  {' · '}
                  {lockedMemberCount != null ? __uiText("{0} คน", {"0": lockedMemberCount.toLocaleString()}) : '—'}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {__uiText("ต้องการรายชื่อใหม่? สร้าง segment ใหม่")}</div>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* No live member count here — GET :id/preview always returns 0 for a live
                segment (it needs per-request device context, not a global count). */}
            <Link
              to={`${ADMIN_ROUTES.users}?segment=${id}`}
              className="text-xs text-blue-600 hover:underline"
            >
              {__uiText("ดู Users")}</Link>
          </div>
        </div>
      </div>

      <Input
        label={__uiText("ชื่อ Segment *")}
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />
      <Input
        label={__uiText("คำอธิบาย (ไม่บังคับ)")}
        value={form.description}
        onChange={(event) =>
          setForm({ ...form, description: event.target.value })
        }
      />

      {locked ? (
        <p className="text-xs text-gray-500">
          {__uiText("เงื่อนไขถูกล็อกไว้ตอนบันทึก แก้ไขไม่ได้ — ดูสรุปเงื่อนไขด้านบน")}</p>
      ) : (
        // Live segment (guest/first_visit/member/staff, no definition) — rule_type itself is locked (the
        // backend only allows a live segment to switch between guest/first_visit, and never
        // to carry a definition); only its rule_config, if any, stays editable.
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            {__uiText("ประเภทกลุ่ม: ")}<strong>{getRuleTypeLabel(form.rule_type)}</strong> {__uiText(" (ไม่สามารถเปลี่ยนได้)")}</p>
          <SegmentRuleConfigFields
            ruleType={form.rule_type}
            value={ruleForm}
            onChange={setRuleForm}
          />
        </div>
      )}

      <details className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          {__uiText("ตั้งค่าขั้นสูง")}</summary>
        <div className="mt-3 space-y-4">
          <Input label={__uiText("Slug (ตัวระบุ URL)")} value={slug} disabled />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) =>
                setForm({ ...form, is_active: event.target.checked })
              }
            />
            {__uiText("เปิดใช้งาน Segment นี้ (Active)")}</label>
        </div>
      </details>
    </AdminInsertLayout>
  );
};

export default EditSegment;

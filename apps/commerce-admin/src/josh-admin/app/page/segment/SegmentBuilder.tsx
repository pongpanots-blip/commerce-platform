// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
import {
  createUserSegment,
  getSegmentFields,
  getUserSegmentById,
  isSegmentBranch,
  previewSegment,
  previewUserSegmentCount,
  updateUserSegment,
  type SegmentBranch,
  type SegmentFieldsResponse,
} from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { LoadError } from '../../components/LoadError';
import { useNavigate, useParams } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import ConditionGroup from './builder/ConditionGroup';
import MembersPanel from './builder/MembersPanel';
import {
  createEmptyGroup,
  describeDefinition,
  pruneEmptyBranches,
  SEGMENT_PRESETS,
} from './builder/segment-definition.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const EMPTY_OPTIONS: SegmentFieldsResponse['options'] = {
  tiers: [],
  cuisine: [],
  cuisine_group: [],
};

/**
 * Visual segment builder (Task 9 of the SEGMENTS/TIERS plan) — the marquee
 * marketing UI. Marketing builds multi-condition AND/OR segments entirely
 * through selects/buttons; the underlying `SegmentDefinition` JSON is never
 * rendered. Doubles as create (`/segments/builder`) and edit
 * (`/segments/builder/:id`) for definition-tree segments, alongside the
 * existing rule_type-based CRUD at `/segments/create` and `/segments/edit/:id`.
 */
export function SegmentBuilder() {
  __useUiLocale();
  const { id: routeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [segmentId, setSegmentId] = useState<string | null>(routeId ?? null);
  const [fieldsData, setFieldsData] = useState<SegmentFieldsResponse | null>(null);
  const [loadingFields, setLoadingFields] = useState(true);
  const [loadingSegment, setLoadingSegment] = useState(Boolean(routeId));
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);

  // Every builder-created segment always carries a `definition`, so it's never "live" — a
  // builder segment opened for edit is always frozen (membership computed + locked at create).
  const locked = Boolean(routeId);
  const [frozenAt, setFrozenAt] = useState<string | null>(null);
  const [frozenMemberCount, setFrozenMemberCount] = useState<number | null>(null);
  const [freezing, setFreezing] = useState(false);

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [tree, setTree] = useState<SegmentBranch>(createEmptyGroup());

  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setLoadError(null); }, [routeId, reload]);

  // Field registry + dynamic option lists (tiers, cuisine) — drives every
  // control in the builder.
  useEffect(() => {
    let active = true;
    setLoadingFields(true);
    getSegmentFields()
      .then(data => { if (active) setFieldsData(data); })
      .catch((error: unknown) => { if (active) { setFieldsData({ fields: [], options: EMPTY_OPTIONS }); setLoadError(error); } })
      .finally(() => { if (active) setLoadingFields(false); });
    return () => { active = false; };
  }, [reload]);

  // Edit mode — load the saved segment and normalize its `definition` (a
  // bare leaf is legal at the top level per the backend shape) into a root
  // AND group so the builder always has one group to render.
  useEffect(() => {
    setLoadingSegment(Boolean(routeId));
    if (!routeId) return;
    let active = true;
    getUserSegmentById(routeId)
      .then(async (segment) => {
        if (!active) return;
        if (!segment) { setLoadError(__uiMessage('ไม่พบกลุ่มลูกค้านี้')); return; }
        setSlug(segment.slug);
        setName(segment.name);
        setDescription(segment.description ?? '');
        setIsActive(segment.is_active);
        setFrozenAt(segment.frozen_at);
        setFrozenMemberCount(segment.member_count);
        if (segment.definition) {
          setTree(
            isSegmentBranch(segment.definition)
              ? segment.definition
              : { op: 'AND', children: [segment.definition] },
          );
        }

        // Legacy segment, never previewed since the freeze-on-read change — one call freezes
        // it (backend), then re-fetch to pick up the now-set frozen_at/member_count.
        if (segment.frozen_at === null) {
          setFreezing(true);
          try {
            await previewUserSegmentCount(routeId);
            const refreshed = await getUserSegmentById(routeId);
            if (active && refreshed) {
              setFrozenAt(refreshed.frozen_at);
              setFrozenMemberCount(refreshed.member_count);
            }
          } catch {
            // ponytail: leave count as "—" on failure — nothing to retry from this page.
          } finally {
            if (active) setFreezing(false);
          }
        }
      })
      .catch((error: unknown) => { if (active) setLoadError(error); })
      .finally(() => { if (active) setLoadingSegment(false); });
    return () => { active = false; };
  }, [routeId, reload]);

  // Live preview (Task 9 step 4) — debounced so we don't fire on every
  // keystroke while typing a value.
  useEffect(() => {
    if (!fieldsData || locked) return;
    const pruned = pruneEmptyBranches(tree);
    if (!pruned) {
      setPreviewCount(null);
      setPreviewError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      setPreviewError(null);
      previewSegment(pruned)
        .then((count) => setPreviewCount(count))
        .catch(() => {
          setPreviewCount(null);
          setPreviewError(__uiMessage("คำนวณจำนวนไม่สำเร็จ — ตรวจสอบเงื่อนไขที่เลือก"));
        })
        .finally(() => setPreviewLoading(false));
    }, 500);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tree), fieldsData]);

  const applyPreset = (build: () => SegmentBranch['children'][number]) => {
    setTree({ op: 'AND', children: [build()] });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert(__uiText("กรุณากรอกชื่อ Segment"));
      return;
    }
    if (!routeId && !slug.trim()) {
      alert(__uiText("กรุณากรอก slug"));
      return;
    }
    // Locked (edit-mode) segments never re-send their definition — only name/description/active.
    const pruned = locked ? null : pruneEmptyBranches(tree);
    if (!locked && !pruned) {
      alert(__uiText("กรุณาเพิ่มอย่างน้อย 1 เงื่อนไข"));
      return;
    }

    setSaving(true);
    try {
      if (routeId) {
        const response = await updateUserSegment(routeId, {
          name: name.trim(),
          description: description.trim() || undefined,
          is_active: isActive,
        });
        if (response.status >= 200 && response.status < 300) {
          alert(__uiText("บันทึกสำเร็จ"));
        }
      } else {
        const response = await createUserSegment({
          slug: slug.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
          // Definition-tree segments (Task 5/6) are matched via the
          // compiler, not `rule_type` — 'member' is a harmless technical
          // default to satisfy the (still-required) column.
          rule_type: 'member',
          definition: pruned,
          is_active: isActive,
        });
        if (response.status >= 200 && response.status < 300) {
          const newId = response.data?.data?.id as string | undefined;
          if (newId) {
            setSegmentId(newId);
            // Swap into edit mode in place so "ดูรายชื่อ" (member list, which
            // needs a saved segment id) becomes available immediately.
            navigate(ADMIN_ROUTES.segmentBuilderEdit(newId), { replace: true });
          } else {
            navigate(ADMIN_ROUTES.segments);
          }
        }
      }
    } catch (error: unknown) {
      // Backend 400s (e.g. a non-UUID manual_user_ids value, or an empty
      // numeric field) put the precise reason in response.data.message —
      // same pattern as the rest of web-admin (see getErrorMessage in page/promotion-common).
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
        (error instanceof Error ? error.message : undefined) ??
        'บันทึกไม่สำเร็จ';
      alert(__uiText("เกิดข้อผิดพลาดในการบันทึก: {0}", {"0": message}));
    } finally {
      setSaving(false);
    }
  };

  const options = fieldsData?.options ?? EMPTY_OPTIONS;
  const fields = fieldsData?.fields ?? [];
  const summary = describeDefinition(tree, fields, options);

  if (loadError) return <LoadError title={__uiText('กำหนดกลุ่มลูกค้า')} error={loadError} onRetry={() => { setLoadError(null); setLoadingFields(true); setLoadingSegment(Boolean(routeId)); setReload(value => value + 1); }} />;
  if (loadingFields || loadingSegment) {
    return <div className="cp-management-page text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate(ADMIN_ROUTES.segments)}
            className="mb-2 text-sm text-gray-500 hover:text-gray-800"
          >
            {__uiText("← กลับ")}</button>
          <h1 className="text-2xl font-bold text-gray-900">
            {routeId ? __uiText("แก้ไข Segment (Visual Builder)") : __uiText("สร้าง Segment ใหม่ (Visual Builder)")}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {__uiText("สร้างกลุ่มลูกค้าด้วยเงื่อนไข AND/OR แบบไม่ต้องเขียนโค้ด")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700">
            {locked ? (
              freezing ? (
                'กำลังคำนวณ...'
              ) : (
                <>
                  <strong>{frozenMemberCount != null ? frozenMemberCount.toLocaleString() : '—'}</strong> {__uiText(" คน")}{frozenAt ? __uiText(" · ล็อกเมื่อ {0}", {"0": new Date(frozenAt).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}) : ''}
                </>
              )
            ) : previewLoading ? (
              'กำลังคำนวณ...'
            ) : previewCount != null ? (
              <>
                ≈ <strong>{previewCount.toLocaleString()}</strong> {__uiText(" ลูกค้า")}</>
            ) : (
              '— ลูกค้า'
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate(ADMIN_ROUTES.segments)}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {__uiText("ยกเลิก")}</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary-light disabled:opacity-50"
          >
            {saving ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
          </button>
        </div>
      </div>

      {previewError && <p className="text-sm text-red-500">{(typeof (previewError) === 'string' ? __uiText(previewError) : previewError)}</p>}

      <div className="flex flex-col gap-5 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Input
              label={__uiText("Slug{0}", {"0": !routeId ? ' *' : ''})}
              value={slug}
              disabled={Boolean(routeId)}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))
              }
              placeholder={__uiText("เช่น vip-customers")}
            />
          </div>
          <div>
            <Input
              label={__uiText("ชื่อ Segment *")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={__uiText("เช่น ลูกค้า VIP")}
            />
          </div>
        </div>

        <div>
          <Input
            label={__uiText("คำอธิบาย")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={__uiText("ไม่บังคับ")}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          {__uiText("เปิดใช้งาน Segment นี้ (Active)")}</label>

        {locked ? (
          <p className="text-xs text-gray-500">
            {__uiText("เงื่อนไขถูกล็อกไว้ตอนบันทึก แก้ไขไม่ได้ — ต้องการรายชื่อใหม่? สร้าง segment ใหม่")}</p>
        ) : (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-600">{__uiText("เริ่มจากแม่แบบ:")}</span>
              {SEGMENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.build)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {fields.length === 0 ? (
              <p className="text-sm text-gray-400">
                {__uiText("ไม่พบ field registry — ตรวจสอบ backend `/user-segments/fields`")}</p>
            ) : (
              <ConditionGroup
                branch={tree}
                fields={fields}
                options={options}
                onChange={setTree}
              />
            )}
          </div>
        )}

        <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3.5 text-sm text-gray-700">
          <span className="font-semibold text-blue-800">{__uiText("สรุปเงื่อนไข: ")}</span>
          {summary}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">{__uiText("รายชื่อลูกค้าที่ตรงเงื่อนไข")}</h2>
          {segmentId && (
            <button
              type="button"
              onClick={() => setShowMembers((prev) => !prev)}
              className="text-xs text-blue-600 hover:underline"
            >
              {showMembers ? __uiText("ซ่อนรายชื่อ") : __uiText("ดูรายชื่อ")}
            </button>
          )}
        </div>

        {!segmentId ? (
          <p className="text-sm text-gray-400">
            {__uiText("บันทึก Segment ก่อน เพื่อดูรายชื่อลูกค้าแบบแบ่งหน้า (ตอนนี้แสดงได้แค่จำนวนโดยประมาณด้านบน)")}</p>
        ) : showMembers ? (
          <MembersPanel segmentId={segmentId} />
        ) : (
          <p className="text-sm text-gray-400">{__uiText("กด \"ดูรายชื่อ\" เพื่อแสดงตาราง")}</p>
        )}
      </div>
    </div>
  );
}

export default SegmentBuilder;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

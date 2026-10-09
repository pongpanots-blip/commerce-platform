import {
  createPromotionMechanic,
  formatBangkokRange,
  getPromotionMechanic,
  getPromotionMechanicAudience,
  getPromotionMechanicCap,
  getPromotionMechanicProductSets,
  listCampaigns,
  updatePromotionMechanic,
  type CampaignListItem,
  type CampaignStatus,
  type PromotionMechanicProductSet,
} from '@josh/shared-api';
import { Button, DateTimeRangeInput, Input, Select } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { MarketingLinkField } from '../../components/MarketingLinkField';
import { SmartLinkField } from '../../components/SmartLinkField';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { Section } from '../coupon/CouponCoreForm';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import {
  CampaignStatusPill,
  EditHistorySection,
  getDuplicateSkus,
  getErrorMessage,
} from '../promotion-common';
import PromotionMechanicAudience from './PromotionMechanicAudience';
import PromotionMechanicDiscountFields from './PromotionMechanicDiscountFields';
import PromotionMechanicProductSets, { type MechanicSku } from './PromotionMechanicProductSets';
import {
  buildCreatePayload,
  MAX_UNIT_CAP,
  buildUpdatePayload,
  emptyMechanicForm,
  formFromMechanic,
  isLegacyKeep,
  originalFromMechanic,
  summarizeLegacyItems,
  validateMechanicForm,
  type MechanicForm,
  type MechanicFormErrors,
  type MechanicOriginal,
} from './promotion-mechanic-form.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const NO_CAMPAIGN = { value: '', get label() { return __uiText("ไม่ผูก Campaign (กำหนดวันที่เอง)"); } };
const PICK_SET_FIRST = 'เลือก Product set ก่อนจึงตั้งส่วนลดได้';
const BADGE_HINT = 'เว้นว่าง = ระบบสร้างป้ายตามภาษาให้เอง แยกกันแต่ละภาษา';

function MechanicEditor({ id }: { id?: string }) {
  __useUiLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaignParam = searchParams.get('campaign_id') ?? '';
  const isEdit = !!id;

  const [form, setForm] = useState<MechanicForm>(emptyMechanicForm);
  const [original, setOriginal] = useState<MechanicOriginal | undefined>();
  const [savedSets, setSavedSets] = useState<PromotionMechanicProductSet[]>([]);
  const [legacySkus, setLegacySkus] = useState<MechanicSku[]>([]);
  const [legacyDiscount, setLegacyDiscount] = useState('');
  const [status, setStatus] = useState<CampaignStatus | undefined>();
  // From the server (`remaining_units` is computed there): what is sold / left of the saved cap.
  const [capStats, setCapStats] = useState<{ sold: number; remaining: number } | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [errors, setErrors] = useState<MechanicFormErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const dateLabelId = React.useId();
  const datesErrorId = React.useId();
  const setsErrorId = React.useId();
  const audienceErrorId = React.useId();
  const lockHintId = React.useId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // the cap and the audience are admin-only data: each is read from its own guarded
        // endpoint, never from the public record (which has neither, nor the company list)
        const [campaignList, record, sets, cap, audience] = await Promise.all([
          listCampaigns(),
          id ? getPromotionMechanic(id) : null,
          id ? getPromotionMechanicProductSets(id) : [],
          id ? getPromotionMechanicCap(id) : null,
          id ? getPromotionMechanicAudience(id) : null,
        ]);
        if (cancelled) return;
        setCampaigns(campaignList);
        if (record) {
          const setIds = sets.map((set) => set.id);
          setForm(formFromMechanic(record, setIds, cap, audience));
          setOriginal(originalFromMechanic(record, setIds, cap, audience));
          setSavedSets(sets);
          setLegacySkus((record.skuItems ?? []).map((item) => ({ sku: item.sku, name: item.product_name ?? null })));
          setLegacyDiscount(summarizeLegacyItems(record.skuItems));
          setStatus(record.status);
          setCapStats(
            cap?.remaining_units == null
              ? null
              : { sold: cap.sold_units, remaining: cap.remaining_units },
          );
        } else if (campaignList.some((campaign) => campaign.id === campaignParam)) {
          setForm((current) => ({ ...current, campaignId: campaignParam }));
        }
        setLoadError('');
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'โหลดข้อมูลไม่สำเร็จ'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, campaignParam, reloadKey]);

  const patch = (partial: Partial<MechanicForm>) => {
    setSaved(false);
    setForm((current) => ({ ...current, ...partial }));
  };

  const handleSave = async () => {
    if (saving) return false;
    const found = validateMechanicForm(form, original);
    setErrors(found);
    setSaved(false);
    if (Object.keys(found).length > 0) {
      setSaveError(__uiMessage("กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง — ตรวจช่องที่ขึ้นสีแดง"));
      return false;
    }
    setSaveError('');
    setSaving(true);
    try {
      if (id && original) {
        await updatePromotionMechanic(id, buildUpdatePayload(form, original));
        setSaved(true);
        // Re-read the saved sets so chips show the new snapshot time and the choices reset.
        setReloadKey((key) => key + 1);
      } else {
        const created = await createPromotionMechanic(buildCreatePayload(form));
        navigate(
          campaignParam && form.campaignId
            ? ADMIN_ROUTES.campaignDetail(form.campaignId)
            : ADMIN_ROUTES.promotionsMechanicEdit(created.id),
        );
        return true;
      }
      return true;
    } catch (err) {
      const duplicates = getDuplicateSkus(err);
      setSaveError(
        duplicates.length > 0
          ? __uiMessage("SKU ซ้ำกับโปรอื่นใน campaign นี้: {0}",{"0":duplicates.join(', ')})
          : getErrorMessage(err, 'บันทึกไม่สำเร็จ'),
      );
      return false;
    } finally {
      setSaving(false);
    }
    return false;
  };

  if (loading) {
    return <div className="cp-management-page text-sm text-ink-muted">{__uiText("กำลังโหลด...")}</div>;
  }
  if (loadError) {
    return (
      <div className="cp-management-page space-y-4">
        <CouponFormErrorBanner error={loadError} />
        <Button
          variant="secondary"
          text={__uiText("ลองใหม่")}
          onClick={() => {
            setLoading(true);
            setReloadKey((key) => key + 1);
          }}
        />
      </div>
    );
  }

  const campaign = campaigns.find((item) => item.id === form.campaignId);
  const basicsOnly = !!original?.basicsOnly;
  const legacy = !!original && !basicsOnly && original.productSetIds.length === 0;
  // A legacy mechanic can't take a value / badge until a set is picked — nothing typed there
  // would be sent, so those fields stay disabled instead of accepting input that is dropped.
  const locked = isLegacyKeep(form, original) && !basicsOnly;

  return (
    <AdminInsertLayout
      title={isEdit ? __uiText("แก้ไขโปรโมชัน") : __uiText("สร้างโปรโมชัน")}
      subtitle={__uiText("สินค้าในชุดที่เลือกได้ส่วนลดเท่ากันทั้งหมด")}
      saveLabel="บันทึกโปรโมชัน"
      steps={['ตั้งชื่อโปรโมชัน', 'เลือกชุดสินค้าและส่วนลด', 'บันทึกโปรโมชัน']}
      backPath={campaignParam ? ADMIN_ROUTES.campaignDetail(campaignParam) : ADMIN_ROUTES.promotionsMechanic}
      saving={saving}
      wide
      headerActions={status ? <CampaignStatusPill status={status} /> : undefined}
      onSave={() => handleSave()}
    >
      <CouponFormErrorBanner error={saveError} />
      {saved && (
        <div
          role="status"
          className="rounded-xl border border-green-100 bg-green-50 p-4 text-sm text-green-700"
        >
          {__uiText("บันทึกแล้ว")}</div>
      )}

      <Section title={__uiText("ข้อมูลโปร")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={__uiText("ชื่อโปร")}
            required
            value={form.name}
            error={errors.name}
            aria-invalid={!!errors.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder={__uiText("เช่น เนื้อลด 20%")}
          />
          {!basicsOnly && (
            <Input
              label={__uiText("ข้อความป้าย (ไทย)")}
              value={form.badgeText}
              disabled={locked}
              aria-describedby={locked ? lockHintId : undefined}
              hint={locked ? PICK_SET_FIRST : BADGE_HINT}
              onChange={(event) => patch({ badgeText: event.target.value })}
              placeholder={__uiText("เช่น ลด 20%")}
            />
          )}
          {!basicsOnly && (
            <Input
              label={__uiText("ข้อความป้าย (English)")}
              value={form.badgeTextEn}
              disabled={locked}
              aria-describedby={locked ? lockHintId : undefined}
              hint={locked ? PICK_SET_FIRST : BADGE_HINT}
              onChange={(event) => patch({ badgeTextEn: event.target.value })}
              placeholder={__uiText("e.g. 20% off")}
            />
          )}
        </div>
        {isEdit && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-primary"
              checked={form.isActive}
              onChange={(event) => patch({ isActive: event.target.checked })}
            />
            <span className="text-sm text-ink-secondary">{__uiText("เปิดใช้งาน")}</span>
          </label>
        )}
      </Section>

      {basicsOnly ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {__uiText("โปรประเภทนี้แก้ได้เฉพาะชื่อ/สถานะ — ส่วนลด วันที่ และ Product set แก้จากหน้านี้ไม่ได้")}</p>
      ) : (
        <>
          <Section
            title={__uiText("Campaign")}
            description={__uiText("ผูกโปรเข้า Campaign เพื่อใช้วันที่เดียวกันทั้งงาน — ไม่ผูกก็ได้แล้วกำหนดวันที่เอง")}
          >
            <div className="sm:w-1/2 sm:pr-2">
              <Select
                label={__uiText("Campaign")}
                data={[
                  NO_CAMPAIGN,
                  ...campaigns.map((item) => ({ value: item.id, label: item.name })),
                ]}
                value={form.campaignId}
                onChange={(event) => patch({ campaignId: event.target.value })}
              />
            </div>
            {campaign ? (
              <div>
                <p className="mb-1 text-sm text-ink-secondary">{__uiText("ระยะเวลา (ใช้วันที่ของ campaign)")}</p>
                <p className="text-sm text-ink">
                  {formatBangkokRange(campaign.start_at, campaign.end_at, 'th')}
                </p>
              </div>
            ) : (
              <div
                role="group"
                aria-labelledby={dateLabelId}
                aria-describedby={errors.dates ? datesErrorId : undefined}
              >
                <p id={dateLabelId} className="mb-1 text-sm text-ink-secondary">
                  {__uiText("ระยะเวลา")}<span className="text-alert"> *</span>
                </p>
                <DateTimeRangeInput
                  startValue={form.startDate}
                  endValue={form.endDate}
                  onStartChange={(value) => patch({ startDate: value })}
                  onEndChange={(value) => patch({ endDate: value })}
                />
                {errors.dates && (
                  <p id={datesErrorId} className="mt-1 text-sm text-alert">
                    {(typeof (errors.dates) === 'string' ? __uiText(errors.dates) : errors.dates)}
                  </p>
                )}
              </div>
            )}
          </Section>

          <Section
            title={__uiText("ส่วนลด")}
            description={__uiText("อยากลดไม่เท่ากันในแต่ละสินค้า ให้สร้างโปรเพิ่มใน campaign เดียวกัน")}
          >
            {legacy && (
              <div className="rounded-lg bg-gray-50 p-3 text-sm">
                <p className="text-xs text-gray-500">{__uiText("ส่วนลดปัจจุบัน (แบบเดิม — ตั้งต่อ SKU, แก้ตรงนี้ไม่ได้)")}</p>
                <p className="font-medium text-ink">{legacyDiscount}</p>
              </div>
            )}
            {locked && (
              <p id={lockHintId} className="text-xs text-amber-700">
                {PICK_SET_FIRST}
              </p>
            )}
            <PromotionMechanicDiscountFields
              form={form}
              onChange={patch}
              errors={errors}
              disabled={locked}
            />
          </Section>

          <Section
            title={__uiText("จำกัดจำนวน (Flash sale)")}
            description={__uiText("จำกัดจำนวนชิ้นที่ขายได้ในราคาโปร (นับรวมทุก SKU ของโปรนี้) — ครบแล้วราคาโปรหยุดใช้เอง ลูกค้าเห็นราคาปกติ")}
          >
            <div className="sm:w-1/2 sm:pr-2">
              <Input
                label={__uiText("จำกัดจำนวน (ชิ้น) (Unit cap)")}
                type="number"
                min={1}
                max={MAX_UNIT_CAP}
                step={1}
                unit="ชิ้น"
                hint={__uiText("เว้นว่าง = ไม่จำกัด — ลดได้ไม่ต่ำกว่าจำนวนที่ขายไปแล้ว")}
                value={form.maxUnits}
                error={errors.maxUnits}
                aria-invalid={!!errors.maxUnits}
                onChange={(event) => patch({ maxUnits: event.target.value })}
              />
            </div>
            {isEdit && capStats && (
              <p
                role="status"
                className={`text-sm ${capStats.remaining === 0 ? 'font-medium text-alert' : 'text-ink-secondary'}`}
              >
                {__uiText("ขายแล้ว ")}{capStats.sold.toLocaleString('th-TH')} {__uiText(" ชิ้น · เหลือ")}{' '}
                {capStats.remaining.toLocaleString('th-TH')} {__uiText(" ชิ้น")}{capStats.remaining === 0 && __uiText(" — หมดแล้ว ตอนนี้ลูกค้าเห็นราคาปกติ")}
              </p>
            )}
          </Section>

          <Section
            title={__uiText("กลุ่มลูกค้า (Audience)")}
            description={__uiText("เลือกได้ว่าโปรนี้ใช้กับทุกคน หรือเฉพาะบางบริษัท — คนที่ไม่เข้าเงื่อนไขจะไม่เห็นโปรนี้เลย (ไม่มีราคาโปร ป้าย หรือขั้นบันได)")}
          >
            <div role="group" aria-label={__uiText("กลุ่มลูกค้าของโปร")}>
              <PromotionMechanicAudience
                audience={form.audience}
                companies={form.audienceCompanies}
                onChange={patch}
                error={errors.audience}
                errorId={audienceErrorId}
              />
            </div>
          </Section>

          <Section
            title={__uiText("รายการสินค้า (Product set)")}
            description={__uiText("ระบบคัดลอกรายการ SKU ของแต่ละชุดไว้ตอนกดบันทึก — แก้ชุดทีหลังไม่กระทบโปร จนกว่าจะเลือก “ใช้รายการล่าสุด”")}
          >
            <div
              role="group"
              aria-label={__uiText("Product set ของโปร")}
              aria-describedby={errors.sets ? setsErrorId : undefined}
            >
              <PromotionMechanicProductSets
                selectedIds={form.productSetIds}
                onChange={(next) => patch({ productSetIds: next })}
                savedSets={savedSets}
                legacy={legacy}
                legacySkus={legacySkus}
                refreshIds={form.refreshSetIds}
                onRefreshChange={(next) => patch({ refreshSetIds: next })}
                error={errors.sets}
                errorId={setsErrorId}
              />
            </div>
          </Section>
        </>
      )}

      {isEdit && id && (
        <Section
          title={__uiText("ลิงก์ Marketing")}
          description={__uiText("ลิงก์เดียว — มือถือเด้งเข้าแอป/สโตร์ ส่วน desktop เปิดหน้าเว็บ เอาไปยิง ads ได้เลย")}
        >
          <MarketingLinkField type="promotion" id={id} buttonLabel="สร้างลิงก์" />
          <SmartLinkField type="promotion" id={id} buttonLabel="สร้าง (self-host)" />
        </Section>
      )}

      {isEdit && id && (
        <EditHistorySection
          entityType="promotion_mechanic"
          entityId={id}
          refreshKey={reloadKey}
          names={Object.fromEntries([...campaigns, ...savedSets].map((item) => [item.id, item.name]))}
        />
      )}
    </AdminInsertLayout>
  );
}

/** Create (`/promotions-mechanic/create`) and edit (`/promotions-mechanic/:id/edit`) share this one page. */
export default function MechanicEditorPage() {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  // key: create → edit navigation after a save must not carry the previous state over.
  return <MechanicEditor key={id ?? 'new'} id={id} />;
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

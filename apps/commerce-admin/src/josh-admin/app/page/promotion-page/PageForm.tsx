// ui-metadata-migration: static labels and UI notices only
import {
  createPromotionPage,
  formatBangkokRange,
  updatePromotionPage,
  uploadImage,
  type CampaignListItem,
  type PromotionPageSummary,
} from '@josh/shared-api';
import { Button, DragDropUpload, Input, Select } from '@josh/shared-ui-web';
import { useEffect, useState, type ReactNode } from 'react';
import { HiOutlineExternalLink } from 'react-icons/hi';
import CopyIdButton from '../../components/CopyIdButton';
import { toShopPath, toShopUrl } from '../../config/admin-base-path';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { resolveAdminAssetUrl } from '../../lib/asset-url';
import CouponConfirmDialog from '../coupon/CouponConfirmDialog';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import { getErrorMessage } from '../promotion-common';
import { FormSection, SwitchField } from './PromotionPageControls';
import { GuardedLink } from './useUnsavedChangesGuard';
import {
  PAGE_SLUG_PATTERN,
  buildCreatePagePayload,
  buildUpdatePagePayload,
  defaultDeeplink,
  emptyPageForm,
  formFromPage,
  isPageFormDirty,
  shopPagePath,
  validatePageForm,
  type ImageField,
  type PageFormErrors,
  type PageFormState,
} from './promotion-page-form.helpers';

/** What the form needs to know about a campaign (list rows and the hub's detail both fit). */
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export type PageFormCampaign = Pick<
  CampaignListItem,
  'id' | 'name' | 'start_at' | 'end_at' | 'page'
>;

const REQUIRED_FIELDS_ERROR =
  'กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง — ตรวจช่องที่ขึ้นสีแดง';

/**
 * State + save for one promotion page. `page` given → edit (PUT), otherwise create (POST).
 * Held outside the fields so a page can put the save button wherever it wants — the
 * campaign hub renders it inline (`PageForm`), the pages menu puts it in the header.
 */
export function usePageForm({
  page,
  campaignId = '',
  onSaved,
}: {
  page?: PromotionPageSummary | null;
  /** Preselected campaign when creating from a campaign. */
  campaignId?: string;
  onSaved: (saved: PromotionPageSummary) => void;
}) {
  const isEdit = !!page;
  const [original, setOriginal] = useState<PageFormState | null>(() =>
    page ? formFromPage(page) : null,
  );
  const [form, setForm] = useState<PageFormState>(
    () => original ?? emptyPageForm(campaignId),
  );
  const [errors, setErrors] = useState<PageFormErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attachPending, setAttachPending] = useState(false);
  const [uploading, setUploading] = useState<
    Partial<Record<ImageField, boolean>>
  >({});
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<ImageField, string>>
  >({});

  const patch = (partial: Partial<PageFormState>) => {
    setSaved(false);
    setForm((current) => ({ ...current, ...partial }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(partial))
        delete next[key as keyof PageFormErrors];
      return next;
    });
  };

  const upload = async (field: ImageField, file: File) => {
    // A save in flight is committing the current image URLs. An upload now passes one of them
    // as replaceUrl and the backend may delete the object the save is about to reference.
    if (saving) return;
    setUploading((current) => ({ ...current, [field]: true }));
    setUploadErrors((current) => ({ ...current, [field]: '' }));
    try {
      // replaceUrl: the backend drops the old file only when no page/banner still uses it.
      const response = await uploadImage(
        file,
        form[field] || undefined,
        'promotions',
      );
      const url = response.data?.data?.url;
      if (!url) throw new Error('อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง');
      patch({ [field]: url });
    } catch (err) {
      setUploadErrors((current) => ({
        ...current,
        [field]: getErrorMessage(err, 'อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง'),
      }));
    } finally {
      setUploading((current) => ({ ...current, [field]: false }));
    }
  };

  /** Attaching a campaign to a page that had none: irreversible from admin, so it is confirmed first. */
  const attaching =
    !!original && !!form.campaignId && form.campaignId !== original.campaignId;

  const save = async (attachConfirmed = false) => {
    if (saving) return false;
    if (Object.values(uploading).some(Boolean)) {
      setSaveError(__uiMessage("กำลังอัปโหลดรูป — รอสักครู่แล้วกดบันทึกอีกครั้ง"));
      return false;
    }
    const found = validatePageForm(form, original);
    setErrors(found);
    setSaved(false);
    if (Object.keys(found).length > 0) {
      setSaveError(REQUIRED_FIELDS_ERROR);
      return false;
    }
    if (attaching && !attachConfirmed) {
      setSaveError('');
      setAttachPending(true);
      return false;
    }
    setSaveError('');
    setSaving(true);
    try {
      if (page && original) {
        const updated = await updatePromotionPage(
          page.id,
          buildUpdatePagePayload(form, original),
        );
        const next = formFromPage(updated);
        setOriginal(next);
        setForm(next);
        setSaved(true);
        onSaved(updated);
      } else {
        onSaved(await createPromotionPage(buildCreatePagePayload(form)));
      }
      return true;
    } catch (err) {
      setSaveError(getErrorMessage(err, 'บันทึกไม่สำเร็จ'));
      return false;
    } finally {
      setSaving(false);
    }
    return false;
  };

  const dirty = isPageFormDirty(form, original ?? emptyPageForm(campaignId));

  return {
    isEdit,
    form,
    patch,
    errors,
    saveError,
    saved,
    saving,
    uploading,
    uploadErrors,
    upload,
    save,
    /** Unsaved edits (compared with the saved page, or the empty form when creating). */
    dirty,
    /** A save is waiting for the admin to confirm attaching a campaign (`confirmAttach` / `cancelAttach`). */
    attachPending,
    confirmAttach: () => {
      setAttachPending(false);
      void save(true);
    },
    cancelAttach: () => setAttachPending(false),
    /** '' when the page has no campaign yet (create, or a legacy page). */
    originalCampaignId: original?.campaignId ?? '',
    /** The deeplink the saved page really has (its own or the slug default); null when creating. */
    savedDeeplink: original
      ? original.deeplink || defaultDeeplink(original.slug)
      : null,
  };
}

export type PageFormApi = ReturnType<typeof usePageForm>;

function BannerImageField({
  label,
  required,
  hint,
  url,
  error,
  uploading,
  disabled,
  onFile,
  onClear,
}: {
  label: string;
  required?: boolean;
  hint: string;
  url: string;
  error?: string;
  uploading?: boolean;
  /** A save is running — no new uploads (see `usePageForm.upload`). */
  disabled?: boolean;
  onFile: (file: File) => void;
  /** Only the English pair can be emptied — the Thai pair is required. */
  onClear?: () => void;
}) {
  __useUiLocale();
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <div>
        <p className="text-sm text-ink-secondary">
          {label}
          {required && <span className="text-alert"> *</span>}
        </p>
        <p className="text-xs text-ink-muted">{hint}</p>
      </div>
      <div inert={disabled} className={disabled ? 'opacity-60' : undefined}>
        <DragDropUpload
          accept="image/*"
          maxSizeMB={5}
          onFileSelect={(file) => !disabled && onFile(file)}
        />
      </div>
      {uploading && <p className="text-xs text-ink-muted">{__uiText("กำลังอัปโหลด...")}</p>}
      {url && (
        <div className="rounded-lg border-2 border-primary-border p-2">
          <img
            src={resolveAdminAssetUrl(url)}
            alt={__uiText("ตัวอย่าง {0}", {"0": label})}
            className="aspect-[3/1] w-full rounded bg-white object-contain"
          />
          {onClear && (
            <button
              type="button"
              className="mt-2 text-xs text-alert hover:underline"
              onClick={onClear}
            >
              {__uiText("ลบรูป (ใช้ภาพภาษาไทยแทน)")}</button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-alert">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
    </div>
  );
}

const DESKTOP_HINT =
  'ขนาดแนะนำ 1200×400 px (3:1) — เท่ากับแบนเนอร์หน้าแรก JPG/PNG/WebP ไม่เกิน 5MB';
const MOBILE_HINT =
  'ขนาดแนะนำ 1200×400 px (3:1) — อัตราส่วนเดียวกับ Desktop JPG/PNG/WebP ไม่เกิน 5MB';

/** Every section of the form. Wrap in whatever layout the page needs. */
export function PageFormFields({
  state,
  campaigns,
  campaignLocked,
  headingLevel = 2,
}: {
  state: PageFormApi;
  campaigns: PageFormCampaign[];
  /** Coming from a campaign: show it read-only instead of a select. */
  campaignLocked?: boolean;
  /** 3 when embedded under a card heading (campaign hub). */
  headingLevel?: 2 | 3;
}) {
  __useUiLocale();
  const {
    isEdit,
    form,
    patch,
    errors,
    saving,
    uploading,
    uploadErrors,
    upload,
  } = state;
  const campaign = campaigns.find((item) => item.id === form.campaignId);
  const slug = form.slug.trim();
  const slugOk = PAGE_SLUG_PATTERN.test(slug);
  // A page belongs to one campaign: fixed once set. Pickable while it has none — on create,
  // or for a legacy page from before campaigns.
  const canPickCampaign = !campaignLocked && !state.originalCampaignId;
  // Campaigns that already have a page would be refused (409) — don't offer them.
  const pickable = campaigns.filter((item) => !item.page);

  const imageErrors: Partial<Record<ImageField, string>> = {
    imageDesktop: errors.imageDesktop,
    imageMobile: errors.imageMobile,
  };

  const image = (
    field: ImageField,
    label: string,
    hint: string,
    required: boolean,
  ) => (
    <BannerImageField
      label={label}
      required={required}
      hint={hint}
      url={form[field]}
      error={imageErrors[field] || uploadErrors[field]}
      uploading={uploading[field]}
      disabled={saving}
      onFile={(file) => void upload(field, file)}
      onClear={required ? undefined : () => patch({ [field]: '' })}
    />
  );

  const section = (
    title: string,
    description: string | undefined,
    children: ReactNode,
  ) => (
    <FormSection title={title} description={description} level={headingLevel}>
      {children}
    </FormSection>
  );

  return (
    <>
      {/* Disabled while saving: edits typed during the save would be overwritten by the saved values. */}
      <fieldset
        disabled={saving}
        className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0"
      >
        {section(
          'ข้อมูลหน้า',
          undefined,
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={__uiText("ลิงก์ของหน้า (slug)")}
                required
                value={form.slug}
                disabled={isEdit}
                error={errors.slug}
                aria-invalid={!!errors.slug}
                hint={
                  isEdit
                    ? __uiText("แก้ไม่ได้หลังสร้าง เพราะลิงก์ที่แชร์ไปแล้วจะเสีย")
                    : __uiText("ตัวพิมพ์เล็ก a-z ตัวเลข และ - ยาว 3–80 ตัวอักษร — แก้ไม่ได้หลังสร้าง")
                }
                placeholder={__uiText("เช่น beef-fest-1111")}
                onChange={(event) => patch({ slug: event.target.value })}
              />
              <Input
                label={__uiText("ชื่อหน้า")}
                required
                value={form.name}
                error={errors.name}
                aria-invalid={!!errors.name}
                hint={__uiText("ชื่อที่ลูกค้าเห็น — เป็นหัวข้อ (h1) และชื่อแท็บของหน้าโปร, ชื่อการ์ดในรายการโปรโมชัน และชื่อแบนเนอร์หน้าแรก")}
                placeholder={__uiText("เช่น Beef Fest 11.11")}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </div>
            {slugOk && (
              <p className="flex flex-wrap items-center gap-x-3 text-xs text-ink-muted">
                <span>{__uiText("ลูกค้าเปิดที่ ")}{toShopPath(shopPagePath(slug))}</span>
                {isEdit && (
                  <a
                    href={toShopUrl(shopPagePath(slug))}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <HiOutlineExternalLink size={16} />
                    {__uiText("เปิดใน shop")}</a>
                )}
              </p>
            )}
          </>,
        )}

        {section(
          __uiText("แคมเปญ"),
          __uiText("หน้าโปรใช้วันที่ของแคมเปญ หนึ่งแคมเปญมีได้หนึ่งหน้า"),
          canPickCampaign ? (
            <>
              <div className="sm:w-1/2 sm:pr-2">
                <Select
                  label={__uiText("แคมเปญ")}
                  data={[
                    {
                      value: '',
                      label: isEdit
                        ? __uiText("— ยังไม่ผูกแคมเปญ —")
                        : __uiText("— เลือกแคมเปญ —"),
                    },
                    ...pickable.map((item) => ({
                      value: item.id,
                      label: item.name,
                    })),
                  ]}
                  value={form.campaignId}
                  error={errors.campaign}
                  hint={
                    isEdit
                      ? __uiText("หน้านี้สร้างก่อนมีแคมเปญและเปิดตลอด ผูกแล้วหน้าจะแสดงเฉพาะสินค้าของโปรอัตโนมัติและคูปองสาธารณะของแคมเปญนั้น (ไม่ใช่โปรเดิม) ใช้วันที่ของแคมเปญ และย้อนกลับไม่ได้ (ระบบจะถามยืนยันก่อนบันทึก)")
                      : __uiText("แสดงเฉพาะแคมเปญที่ยังไม่มีหน้าโปร")
                  }
                  onChange={(event) =>
                    patch({ campaignId: event.target.value })
                  }
                />
              </div>
              {campaign && (
                <p className="text-xs text-ink-muted">
                  {formatBangkokRange(campaign.start_at, campaign.end_at, 'th')}{' '}
                  {__uiText("(ใช้วันที่ของแคมเปญ)")}</p>
              )}
            </>
          ) : (
            <div>
              <p className="mb-1 text-sm text-ink-secondary">{__uiText("แคมเปญ")}</p>
              {campaign ? (
                <>
                  {isEdit && !campaignLocked ? (
                    <GuardedLink
                      to={ADMIN_ROUTES.campaignDetail(campaign.id)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      {campaign.name}
                    </GuardedLink>
                  ) : (
                    <p className="text-sm text-ink">{campaign.name}</p>
                  )}
                  <p className="mt-1 text-xs text-ink-muted">
                    {formatBangkokRange(
                      campaign.start_at,
                      campaign.end_at,
                      'th',
                    )}{' '}
                    {__uiText("(ใช้วันที่ของแคมเปญ แก้ได้ที่หน้าแคมเปญ)")}</p>
                </>
              ) : (
                <p className="text-sm text-ink-muted">
                  {__uiText("ไม่พบแคมเปญของหน้านี้")}</p>
              )}
            </div>
          ),
        )}

        {section(
          'แบนเนอร์',
          'ลูกค้า English เห็นภาพ English ถ้าอัปโหลดไว้ ไม่มีก็เห็นภาพภาษาไทย',
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {image('imageDesktop', 'ภาพ Desktop (TH)', DESKTOP_HINT, true)}
            {image('imageMobile', 'ภาพ Mobile (TH)', MOBILE_HINT, true)}
            {image('imageDesktopEn', 'ภาพ Desktop (EN)', DESKTOP_HINT, false)}
            {image('imageMobileEn', 'ภาพ Mobile (EN)', MOBILE_HINT, false)}
          </div>,
        )}

        {section(
          'Deeplink แอปมือถือ',
          'ลิงก์ที่แอปใช้เปิดหน้านี้',
          <>
            <div className="flex items-start gap-2">
              <Input
                label={__uiText("ลิงก์เปิดในแอป (deeplink)")}
                value={form.deeplink}
                error={errors.deeplink}
                aria-invalid={!!errors.deeplink}
                placeholder={defaultDeeplink(slug || '<slug>')}
                hint={__uiText("เว้นว่าง = ใช้ค่าเริ่มต้น (ที่แสดงในช่อง)")}
                onChange={(event) => patch({ deeplink: event.target.value })}
              />
              {form.deeplink && (
                <Button
                  variant="secondary"
                  text={__uiText("ใช้ค่าเริ่มต้น")}
                  className="mt-6 shrink-0"
                  onClick={() => patch({ deeplink: '' })}
                />
              )}
            </div>
            {state.savedDeeplink && (
              <p className="flex flex-wrap items-center gap-x-1 text-xs text-ink-muted">
                <span>
                  {__uiText("Deeplink ที่บันทึกไว้:")}{' '}
                  <code className="break-all text-ink">
                    {state.savedDeeplink}
                  </code>
                </span>
                <CopyIdButton
                  id={state.savedDeeplink}
                  label={__uiText("คัดลอก deeplink")}
                />
              </p>
            )}
          </>,
        )}

        {section(
          'การแสดงผล',
          undefined,
          <>
            <SwitchField
              label={__uiText("แสดงแบนเนอร์บนหน้าแรก")}
              description={__uiText("ระบบสร้าง/อัปเดต/ลบแบนเนอร์ HERO ของหน้านี้ให้เอง — ใช้ภาพและวันที่ของหน้า")}
              checked={form.showOnHome}
              onChange={(checked) => patch({ showOnHome: checked })}
            />
            <div className="sm:w-1/2 sm:pr-2">
              <Input
                label={__uiText("ลำดับบนหน้าแรก")}
                type="number"
                min={0}
                step={1}
                value={form.homeSortOrder}
                disabled={!form.showOnHome}
                error={errors.homeSortOrder}
                hint={__uiText("เลขน้อยขึ้นก่อน")}
                onChange={(event) =>
                  patch({ homeSortOrder: event.target.value })
                }
              />
            </div>
            <SwitchField
              label={__uiText("เปิดใช้งาน")}
              description={__uiText("ปิด = ลูกค้าเปิดหน้านี้ไม่ได้ (404) และแบนเนอร์หน้าแรกถูกปิดด้วย")}
              checked={form.isActive}
              onChange={(checked) => patch({ isActive: checked })}
            />
          </>,
        )}
      </fieldset>

      <CouponConfirmDialog
        open={state.attachPending}
        title={__uiText("ผูกหน้านี้กับแคมเปญ?")}
        body={
          <>
            <p>
              {__uiText("หลังผูกกับ “")}{campaign?.name ?? ''}{__uiText("” หน้านี้จะแสดงเฉพาะสินค้าของโปรอัตโนมัติและคูปองสาธารณะของแคมเปญนั้น (รวมสินค้าที่คูปองจำกัดไว้) สินค้าของโปรเดิมที่หน้านี้ใช้อยู่จะหายไป ถ้าโปรนั้นไม่ได้อยู่ในแคมเปญนี้")}</p>
            <p className="mt-2">
              {__uiText("วันที่ของหน้าจะเปลี่ยนเป็นวันที่ของแคมเปญ และ")}{' '}
              <strong>{__uiText("ย้อนกลับหรือเปลี่ยนแคมเปญภายหลังไม่ได้")}</strong>
            </p>
          </>
        }
        confirmLabel={__uiText("ผูกแคมเปญ")}
        tone="danger"
        onCancel={state.cancelAttach}
        onConfirm={state.confirmAttach}
      />
    </>
  );
}

/** Self-contained form with its own save button — for embedding (campaign hub). */
export default function PageForm({
  page,
  campaigns,
  campaignId,
  campaignLocked,
  headingLevel,
  onDirtyChange,
  onSaved,
}: {
  page?: PromotionPageSummary | null;
  campaigns: PageFormCampaign[];
  campaignId?: string;
  campaignLocked?: boolean;
  headingLevel?: 2 | 3;
  /** Told whenever the form gains or loses unsaved edits (false again on unmount). Pass a stable function. */
  onDirtyChange?: (dirty: boolean) => void;
  onSaved: (saved: PromotionPageSummary) => void;
}) {
  __useUiLocale();
  const state = usePageForm({ page, campaignId, onSaved });
  useEffect(() => {
    onDirtyChange?.(state.dirty);
  }, [state.dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  return (
    <div className="flex flex-col gap-5">
      <CouponFormErrorBanner error={state.saveError} />
      {state.saved && (
        <p role="status" className="text-sm font-medium text-ok">
          {__uiText("บันทึกแล้ว")}</p>
      )}
      <PageFormFields
        state={state}
        campaigns={campaigns}
        campaignLocked={campaignLocked}
        headingLevel={headingLevel}
      />
      <div className="flex justify-end">
        <Button
          text={
            state.saving
              ? __uiText("กำลังบันทึก...")
              : state.isEdit
                ? __uiText("บันทึกหน้าโปร")
                : __uiText("สร้างหน้าโปร")
          }
          disabled={state.saving}
          onClick={() => void state.save()}
        />
      </div>
    </div>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

import { DateTimeRangeInput, Input, Select } from '@josh/shared-ui-web';
import React, { useMemo } from 'react';
import { RichTextEditor, isRichTextEmpty } from '../../components/rich-text/RichTextEditor';
import CouponImageField from './CouponImageField';
import CouponOptionToggle from './CouponOptionToggle';
import {
  COUPON_CODE_MAX_LENGTH,
  validateCouponCoreForm,
  type CouponCoreForm as CouponCoreFormState,
} from './coupon-core-form.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-gray-100 pt-5 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {description && (
          <p className="mt-1 text-xs text-gray-500">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function FieldLabel({
  children,
  required,
  htmlFor,
}: {
  children: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm text-gray-600">
      {children}
      {required ? <span className="text-red-500"> *</span> : null}
    </label>
  );
}

type CouponCoreFormProps = {
  form: CouponCoreFormState;
  /** React `setState`-style — accepts either a next value or an updater function. Callers pass
   * their raw `setForm` directly (both CreateCoupon and CouponDetail already do), so `patch`
   * below can use the functional form and always merge into the LATEST state instead of the
   * `form` prop captured in whichever render's closure a child (e.g. RichTextEditor, whose
   * tiptap instance can call back well after the render that created it) happens to fire from —
   * a stale closure there previously could patch a single field and silently reset every
   * sibling field to whatever `form` was at that render. */
  onChange: (next: CouponCoreFormState | ((prev: CouponCoreFormState) => CouponCoreFormState)) => void;
  disabled?: boolean;
  formError?: string;
  pendingImageFile: File | null;
  onPendingImageFileChange: (file: File | null) => void;
  imageUrl?: string | null;
  /** Section rendered between "ข้อมูลพื้นฐาน" and "ประเภทและส่วนลด" — owned by the page (CouponAudienceFields). */
  audienceSection?: React.ReactNode;
  /** Section rendered after "ประเภทและส่วนลด" — owned by the page (CouponRedemptionRuleFields). */
  redemptionSection?: React.ReactNode;
  /** true once the coupon has any entitlement or usage (`coupon.code_locked`), OR (CreateCoupon)
   * once the coupon row has been created by an earlier save attempt — either way the backend
   * rejects a coupon_code/code_generation change past this point, so the code input is disabled
   * here too. */
  codeLocked?: boolean;
  /** Hint shown under the code input while `codeLocked` — the reason differs by caller (already
   * distributed/used vs. "just created, locked so a retry can't change it"), so this defaults to
   * CouponDetail's wording and CreateCoupon overrides it. */
  codeLockedHint?: string;
  /** The coupon record as loaded (CouponDetail's `coupon` state) — forwarded to
   * validateCouponCoreForm so an untouched discount cap on an old coupon doesn't show a red
   * error here even though saving it is allowed (see coupon-core-form.helpers.ts). CreateCoupon
   * never passes this — a new coupon has nothing to compare against and stays strict. */
  originalCoupon?: Parameters<typeof validateCouponCoreForm>[1];
  /** true when the chosen audience is "ทุกคน (Public)" — the only audience `auto_apply` is allowed
   * for (backend 400s otherwise), so the toggle is disabled and shown off for any other audience. */
  audienceIsPublic?: boolean;
};

/** Shared coupon form used by both CreateCoupon and CouponDetail — everything except audience/redemption rules and is_active (header switch). */
export function CouponCoreForm({
  form,
  onChange,
  disabled,
  formError,
  pendingImageFile,
  onPendingImageFileChange,
  imageUrl,
  audienceSection,
  redemptionSection,
  codeLocked = false,
  codeLockedHint = 'มีการแจกหรือใช้คูปองนี้แล้ว — เปลี่ยนรหัสไม่ได้',
  originalCoupon,
  audienceIsPublic = false,
}: CouponCoreFormProps) {
  __useUiLocale();
  const couponTypeId = React.useId();
  const discountTypeId = React.useId();
  const couponCodeId = React.useId();
  const titleId = React.useId();
  const titleEnId = React.useId();
  const discountValueId = React.useId();

  const fieldErrors = useMemo(
    () => validateCouponCoreForm(form, originalCoupon).fieldErrors,
    [form, originalCoupon],
  );

  const patch = (partial: Partial<CouponCoreFormState>) =>
    onChange((prev) => ({ ...prev, ...partial }));

  return (
    <>
      <Section
        title={__uiText("ข้อมูลพื้นฐาน")}
        description={__uiText("รหัสและชื่อที่ลูกค้าจะเห็นตอนใช้คูปอง")}
      >
        <div className="sm:w-1/2 sm:pr-2">
          <FieldLabel required htmlFor={couponCodeId}>{__uiText("รหัสคูปอง")}</FieldLabel>
          <Input
            id={couponCodeId}
            value={form.coupon_code}
            disabled={disabled || codeLocked}
            maxLength={COUPON_CODE_MAX_LENGTH}
            error={fieldErrors.coupon_code}
            hint={
              codeLocked
                ? codeLockedHint
                : __uiText("สูงสุด {0} ตัวอักษร", {"0": COUPON_CODE_MAX_LENGTH})
            }
            onChange={(event) =>
              patch({ coupon_code: event.target.value.toUpperCase().replace(/\s+/g, '') })
            }
            placeholder={__uiText("เช่น SUMMER26")}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required htmlFor={titleId}>{__uiText("ชื่อคูปอง (ไทย)")}</FieldLabel>
            <Input
              id={titleId}
              value={form.title}
              disabled={disabled}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder={__uiText("เช่น ลด 10% ซื้อครบ 3,000")}
            />
          </div>
          <div>
            <FieldLabel required htmlFor={titleEnId}>{__uiText("ชื่อคูปอง (ภาษาอังกฤษ)")}</FieldLabel>
            <Input
              id={titleEnId}
              value={form.title_en}
              disabled={disabled}
              onChange={(event) => patch({ title_en: event.target.value })}
              placeholder={__uiText("e.g. 10% off orders over 3,000")}
            />
          </div>
        </div>
        <div>
          <FieldLabel required>{__uiText("ระยะเวลา")}</FieldLabel>
          <DateTimeRangeInput
            startValue={form.start_date}
            endValue={form.end_date}
            onStartChange={(value) => patch({ start_date: value })}
            onEndChange={(value) => patch({ end_date: value })}
            disabled={disabled}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>{__uiText("สินค้าที่ร่วมรายการ (ไทย)")}</FieldLabel>
            <RichTextEditor
              value={form.applicable_products_th}
              ariaLabel="สินค้าที่ร่วมรายการ (ไทย)"
              onChange={(html) => patch({ applicable_products_th: html })}
              invalid={!!formError && isRichTextEmpty(form.applicable_products_th)}
              disabled={disabled}
            />
          </div>
          <div>
            <FieldLabel required>{__uiText("สินค้าที่ร่วมรายการ (ภาษาอังกฤษ)")}</FieldLabel>
            <RichTextEditor
              value={form.applicable_products_en}
              ariaLabel="สินค้าที่ร่วมรายการ (ภาษาอังกฤษ)"
              onChange={(html) => patch({ applicable_products_en: html })}
              invalid={!!formError && isRichTextEmpty(form.applicable_products_en)}
              disabled={disabled}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>{__uiText("รายละเอียด (ไทย)")}</FieldLabel>
            <RichTextEditor
              value={form.description}
              ariaLabel="รายละเอียด (ไทย)"
              onChange={(html) => patch({ description: html })}
              invalid={!!formError && isRichTextEmpty(form.description)}
              disabled={disabled}
            />
          </div>
          <div>
            <FieldLabel required>{__uiText("รายละเอียด (ภาษาอังกฤษ)")}</FieldLabel>
            <RichTextEditor
              value={form.description_en}
              ariaLabel="รายละเอียด (ภาษาอังกฤษ)"
              onChange={(html) => patch({ description_en: html })}
              invalid={!!formError && isRichTextEmpty(form.description_en)}
              disabled={disabled}
            />
          </div>
        </div>
        <CouponImageField
          imageUrl={imageUrl}
          pendingFile={pendingImageFile}
          onPendingFileChange={onPendingImageFileChange}
          disabled={disabled}
        />
      </Section>

      {audienceSection}

      <Section
        title={__uiText("ประเภทและส่วนลด")}
        description={__uiText("กำหนดรูปแบบส่วนลดและจำนวนครั้งที่ใช้ได้")}
      >
        <div className="sm:w-1/2 sm:pr-2">
          <FieldLabel htmlFor={couponTypeId}>{__uiText("ประเภทคูปอง")}</FieldLabel>
          <Select
            id={couponTypeId}
            className="w-full"
            value={form.coupon_type}
            disabled={disabled}
            onChange={(event) =>
              patch({ coupon_type: event.target.value as CouponCoreFormState['coupon_type'] })
            }
          >
            <option value="discount">{__uiText("ส่วนลดทันที (Discount)")}</option>
            <option value="cashback">{__uiText("คืนเงิน/เครดิต (Cashback)")}</option>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required htmlFor={discountTypeId}>{__uiText("ประเภทส่วนลด")}</FieldLabel>
            <Select
              id={discountTypeId}
              className="w-full"
              value={form.discount_type}
              disabled={disabled}
              onChange={(event) =>
                patch({ discount_type: event.target.value as 'PERCENTAGE' | 'FIXED_AMOUNT' })
              }
            >
              <option value="PERCENTAGE">{__uiText("เปอร์เซ็นต์ (%)")}</option>
              <option value="FIXED_AMOUNT">{__uiText("จำนวนเงินคงที่ (บาท)")}</option>
            </Select>
          </div>
          <div>
            <FieldLabel required htmlFor={discountValueId}>
              {form.discount_type === 'PERCENTAGE' ? __uiText("ส่วนลด (%)") : __uiText("ส่วนลด (บาท)")}
            </FieldLabel>
            <Input
              id={discountValueId}
              value={form.discount_value}
              disabled={disabled}
              onChange={(event) => patch({ discount_value: event.target.value })}
              placeholder={form.discount_type === 'PERCENTAGE' ? '10' : '200'}
            />
          </div>
        </div>

        {form.discount_type === 'PERCENTAGE' && (
          <div>
            <Input
              label={__uiText("ส่วนลดสูงสุด (บาท)")}
              required
              value={form.maximum_discount_amount}
              disabled={disabled}
              error={fieldErrors.maximum_discount_amount}
              onChange={(event) => patch({ maximum_discount_amount: event.target.value })}
              placeholder={__uiText("เช่น 200")}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Input
              label={__uiText("จำกัดทั้งระบบ (ครั้ง)")}
              required
              value={form.global_limit}
              disabled={disabled}
              error={fieldErrors.global_limit}
              onChange={(event) => patch({ global_limit: event.target.value })}
              placeholder={__uiText("เช่น 1000")}
            />
          </div>
          <div>
            <Input
              label={__uiText("จำกัดต่อผู้ใช้/สาขา (ครั้ง)")}
              required
              hint={__uiText("นับรวมทุก user ในสาขาเดียวกัน")}
              value={form.user_limit}
              disabled={disabled}
              error={fieldErrors.user_limit}
              onChange={(event) => patch({ user_limit: event.target.value })}
              placeholder="1"
            />
          </div>
        </div>

        <CouponOptionToggle
          checked={!!form.auto_apply && audienceIsPublic}
          disabled={disabled || !audienceIsPublic}
          onChange={(checked) => patch({ auto_apply: checked })}
          title={__uiText("ใช้อัตโนมัติ (ไม่ต้องกรอกโค้ด) (Auto apply)")}
          description={
            audienceIsPublic
              ? __uiText("ระบบใส่ให้ตอน checkout เมื่อลูกค้าไม่ได้กรอกโค้ดอื่น (ถ้ามีหลายใบ เลือกใบที่ลดมากสุด) — ตั้งจำนวนครั้งที่ใช้ให้เหมาะสม เพราะค่าเริ่มต้นจำกัดต่อผู้ใช้/สาขาแค่ 1 ครั้ง")
              : __uiText("ต้องตั้งกลุ่มเป้าหมายเป็น \"ทุกคน (Public)\" ก่อน จึงเปิดใช้อัตโนมัติได้")
          }
        />
      </Section>

      {redemptionSection}
    </>
  );
}

export default CouponCoreForm;

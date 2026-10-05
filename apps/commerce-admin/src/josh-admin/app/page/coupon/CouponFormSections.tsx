import type { CouponDiscountScope } from '@josh/shared-api';
import React from 'react';
import CouponAudienceFields from './CouponAudienceFields';
import { Section } from './CouponCoreForm';
import CouponRedemptionRuleFields from './CouponRedemptionRuleFields';
import {
  isNewSignupAudience,
  type CouponAudienceForm,
} from './coupon-audience.helpers';
import type { CouponCoreForm } from './coupon-core-form.helpers';
import type { CouponRedemptionForm } from './coupon-redemption.helpers';

/**
 * Shared audience-change side effect: switching to the "สมาชิกใหม่" audience forces
 * user_limit to '1' — both CreateCoupon and CouponDetail must use this same handler so
 * switching audience on either page behaves identically.
 */
export function applyCouponAudienceChange(
  next: CouponAudienceForm,
  setAudience: (next: CouponAudienceForm) => void,
  setForm: (updater: (current: CouponCoreForm) => CouponCoreForm) => void,
) {
  setAudience(next);
  if (isNewSignupAudience(next.mode)) {
    setForm((current) => ({ ...current, user_limit: '1' }));
  }
}

/** Red validation/API-error banner shared by CreateCoupon and CouponDetail — same markup on both pages. */
export function CouponFormErrorBanner({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"
    >
      {error}
    </div>
  );
}

/** `lockedNote` content for a chain coupon (B) — shared by CreateCoupon (picking the source)
 * and CouponDetail (already-granted chains) so the copy/markup stays in one place. */
export function ChainLockedAudienceNote({ sourceLabel }: { sourceLabel: string }) {
  return (
    <p className="text-xs text-violet-700">
      ผู้ที่ใช้คูปอง {sourceLabel} สำเร็จ จะได้รับคูปองนี้อัตโนมัติ
    </p>
  );
}

type AudienceFormSectionProps = {
  audience: CouponAudienceForm;
  onAudienceChange: (next: CouponAudienceForm) => void;
  disabled?: boolean;
  codeGeneration: 'shared' | 'unique_suffix';
  onCodeGenerationChange: (next: 'shared' | 'unique_suffix') => void;
  /** Detail-only extras (segment edit link, auto-generate hint, …) rendered after the shared fields. */
  children?: React.ReactNode;
  /** Chain coupons (kind === 'chain'): replaces the audience mode fields with a fixed
   * explanation, since who gets the coupon is decided entirely by the reward rule, not a mode pick. */
  lockedNote?: React.ReactNode;
  /** true once the coupon has any entitlement or usage (`coupon.code_locked`) — forwarded to
   * CouponAudienceFields to lock the "สร้างรหัสเฉพาะต่อคน" toggle alongside the coupon code. */
  codeGenerationLocked?: boolean;
};

/** "กลุ่มเป้าหมาย" section shared by CreateCoupon and CouponDetail. */
export function CouponAudienceSection({
  audience,
  onAudienceChange,
  disabled,
  codeGeneration,
  onCodeGenerationChange,
  children,
  lockedNote,
  codeGenerationLocked,
}: AudienceFormSectionProps) {
  return (
    <Section title="กลุ่มเป้าหมาย" description="เลือกว่าใครมีสิทธิ์ได้รับคูปองนี้">
      {lockedNote ?? (
        <>
          <CouponAudienceFields
            value={audience}
            onChange={onAudienceChange}
            disabled={disabled}
            codeGeneration={codeGeneration}
            onCodeGenerationChange={onCodeGenerationChange}
            codeGenerationLocked={codeGenerationLocked}
          />
          {isNewSignupAudience(audience.mode) && (
            <p className="text-xs text-violet-700">
              คูปองนี้จะมอบให้สมาชิกใหม่ทันทีหลังสมัคร — ลูกค้าใช้รหัสคูปองที่หน้าชำระเงิน
            </p>
          )}
        </>
      )}
      {children}
    </Section>
  );
}

type RedemptionFormSectionProps = {
  value: CouponRedemptionForm;
  onChange: (next: CouponRedemptionForm) => void;
  discountScope: CouponDiscountScope;
  onDiscountScopeChange: (next: CouponDiscountScope) => void;
  disabled?: boolean;
};

/** "เงื่อนไขใช้โค้ด" section shared by CreateCoupon and CouponDetail. */
export function CouponRedemptionSection({
  value,
  onChange,
  discountScope,
  onDiscountScopeChange,
  disabled,
}: RedemptionFormSectionProps) {
  return (
    <Section
      title="เงื่อนไขใช้โค้ด"
      description="ขอบเขตส่วนลด, ยอดตะกร้าขั้นต่ำ, SKU ขั้นต่ำ และช่องทางชำระเงิน"
    >
      <CouponRedemptionRuleFields
        value={value}
        onChange={onChange}
        discountScope={discountScope}
        onDiscountScopeChange={onDiscountScopeChange}
        disabled={disabled}
      />
    </Section>
  );
}

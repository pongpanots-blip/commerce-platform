import {
  generateCouponEntitlementsFromSegment,
  importCouponEntitlements,
  updateCoupon,
} from '@josh/shared-api';
import {
  parseRecipientTokens,
  rowsToImportPayload,
  type CsvImportRow,
} from './coupon-import.helpers';

export type CouponAudienceMode = 'all' | 'new_signup' | 'segment' | 'manual';

// Mirrors the backend enum exactly (apps/backend/src/shared/enums/coupon.enum.ts
// CouponDistributionType) — every value it has must round-trip through this form.
export type CouponDistributionType = 'public' | 'assigned' | 'unique_per_user';

export type CouponAudienceForm = {
  mode: CouponAudienceMode;
  segmentId: string | null;
  recipientText: string;
  recipientFile: { name: string; rows: CsvImportRow[] } | null;
  /** The coupon's real distribution_type, carried through unedited. The admin UI has no
   * control to choose between 'assigned' and 'unique_per_user' (both look like "manual" mode
   * here) — previously every non-'all' save hardcoded 'assigned', so re-saving a
   * unique_per_user coupon after an unrelated edit (e.g. renaming it) silently downgraded it
   * (M12). 'all' mode is the one exception: it always means 'public', regardless of what this
   * holds. New coupons created here default to 'assigned' (see EMPTY_COUPON_AUDIENCE_FORM). */
  distributionType: CouponDistributionType;
};

export const EMPTY_COUPON_AUDIENCE_FORM: CouponAudienceForm = {
  mode: 'all',
  segmentId: null,
  recipientText: '',
  recipientFile: null,
  distributionType: 'assigned',
};

/** Combined pending recipients (file + pasted tokens) for manual-mode import on save. */
export function pendingRecipientRows(form: CouponAudienceForm): CsvImportRow[] {
  return [...(form.recipientFile?.rows ?? []), ...parseRecipientTokens(form.recipientText)];
}

export const COUPON_AUDIENCE_MODES: Array<{
  value: CouponAudienceMode;
  label: string;
  hint: string;
}> = [
  {
    value: 'all',
    label: 'ทุกคน (Public)',
    hint: 'ไม่จำกัดกลุ่ม — ใครมีรหัสก็ใช้ได้',
  },
  {
    value: 'new_signup',
    label: 'สมาชิกใหม่ (มอบอัตโนมัติเมื่อสมัคร)',
    hint: 'ผู้ใช้ที่สมัครสำเร็จจะได้สิทธิ์ทันที — ไม่ต้องอัปโหลดรายชื่อ',
  },
  {
    value: 'segment',
    label: 'ระบุ segment',
    hint: 'เลือกจาก user segment ที่สร้างไว้ (รองรับ segment builder)',
  },
  {
    value: 'manual',
    label: 'ระบุรายชื่อเอง',
    hint: 'กำหนดรายชื่อเอง (CSV / user_id)',
  },
];

export function isNewSignupAudience(mode: CouponAudienceMode): boolean {
  return mode === 'new_signup';
}

export function audienceFormFromCoupon(
  coupon: {
    auto_grant_on_signup?: boolean;
    audience_segment_id?: string | null;
    distribution_type?: string;
    enforce_audience_at_redemption?: boolean;
  } | null,
): CouponAudienceForm {
  if (!coupon) {
    return { ...EMPTY_COUPON_AUDIENCE_FORM };
  }
  // Carries whatever the coupon actually has (falls back to 'assigned' for a legacy/odd
  // value so an unrecognised string never turns into 'public' on save) — every branch below
  // reuses this instead of hardcoding 'assigned', see CouponDistributionType above.
  const distributionType: CouponDistributionType =
    coupon.distribution_type === 'public' || coupon.distribution_type === 'unique_per_user'
      ? coupon.distribution_type
      : 'assigned';

  if (coupon.auto_grant_on_signup && !coupon.audience_segment_id) {
    return {
      mode: 'new_signup',
      segmentId: null,
      recipientText: '',
      recipientFile: null,
      distributionType,
    };
  }
  if (coupon.audience_segment_id) {
    return {
      mode: 'segment',
      segmentId: coupon.audience_segment_id,
      recipientText: '',
      recipientFile: null,
      distributionType,
    };
  }
  if (coupon.distribution_type === 'assigned' || coupon.distribution_type === 'unique_per_user') {
    return {
      mode: 'manual',
      segmentId: null,
      recipientText: '',
      recipientFile: null,
      distributionType,
    };
  }
  return { ...EMPTY_COUPON_AUDIENCE_FORM };
}

export function validateCouponAudienceForm(
  form: CouponAudienceForm,
): string | null {
  if (form.mode === 'segment' && !form.segmentId) {
    return 'กรุณาเลือก segment';
  }
  return null;
}

export function describeCouponAudience(
  form: CouponAudienceForm,
  segmentName?: string,
): string {
  switch (form.mode) {
    case 'all':
      return 'ทุกคน (Public)';
    case 'new_signup':
      return 'สมาชิกใหม่ — มอบอัตโนมัติเมื่อสมัคร';
    case 'segment':
      return segmentName ? `Segment: ${segmentName}` : 'ระบุ segment';
    case 'manual':
      return 'ระบุรายชื่อเอง (CSV / user_id)';
    default:
      return '—';
  }
}

export type SaveCouponAudienceResult = {
  segmentId: string | null;
  importSummary: string | null;
};

/** Same summary format CouponDetail's old CSV-upload handler used: "นำเข้า X รายการ · match Y คน" + notFound preview. */
function formatImportSummary(result: {
  created?: number;
  matchedUsers?: number;
  notFound?: string[];
} | null | undefined): string {
  const notFound = result?.notFound ?? [];
  return (
    `นำเข้า ${result?.created ?? 0} รายการ · match ${result?.matchedUsers ?? 0} คน` +
    (notFound.length > 0
      ? ` · ไม่พบ ${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? '…' : ''}`
      : '')
  );
}

export async function saveCouponAudience(
  couponId: string,
  form: CouponAudienceForm,
  options?: { autoGenerateEntitlements?: boolean },
): Promise<SaveCouponAudienceResult> {
  if (form.mode === 'all') {
    await updateCoupon(couponId, {
      audience_segment_id: null,
      enforce_audience_at_redemption: false,
      distribution_type: 'public',
      auto_grant_on_signup: false,
    });
    return { segmentId: null, importSummary: null };
  }

  if (form.mode === 'new_signup') {
    await updateCoupon(couponId, {
      audience_segment_id: null,
      enforce_audience_at_redemption: false,
      distribution_type: form.distributionType,
      auto_grant_on_signup: true,
    });
    return { segmentId: null, importSummary: null };
  }

  if (form.mode === 'manual') {
    await updateCoupon(couponId, {
      audience_segment_id: null,
      enforce_audience_at_redemption: false,
      distribution_type: form.distributionType,
      auto_grant_on_signup: false,
    });

    const rows = pendingRecipientRows(form);
    let importSummary: string | null = null;
    if (rows.length > 0) {
      const response = await importCouponEntitlements(couponId, {
        ...rowsToImportPayload(rows),
        activate: true,
      });
      importSummary = formatImportSummary(response.data?.data);
    }

    return { segmentId: null, importSummary };
  }

  // form.mode === 'segment'
  await updateCoupon(couponId, {
    audience_segment_id: form.segmentId,
    enforce_audience_at_redemption: true,
    distribution_type: form.distributionType,
    auto_grant_on_signup: false,
  });

  if (options?.autoGenerateEntitlements && form.segmentId) {
    await generateCouponEntitlementsFromSegment(couponId, { activate: true });
  }

  return { segmentId: form.segmentId, importSummary: null };
}

import { uiText as __uiText } from '@cp/ui';
import {
  fromBangkokInputValue,
  toBangkokInputValue,
  type CampaignDetail,
  type CreateCampaignPayload,
  type UpdateCampaignPayload,
} from '@josh/shared-api';
import { ADMIN_ROUTES } from '../../config/admin-routes';

/** Dates are Bangkok `YYYY-MM-DDTHH:mm` (what `<input type="datetime-local">` holds). */
export type CampaignForm = {
  name: string;
  startAt: string;
  endAt: string;
  isActive: boolean;
};

export type CampaignFormErrors = Partial<Record<'name' | 'dates', string>>;

export const emptyCampaignForm = (): CampaignForm => ({ name: '', startAt: '', endAt: '', isActive: true });

export const formFromCampaign = (campaign: CampaignDetail): CampaignForm => ({
  name: campaign.name,
  startAt: toBangkokInputValue(campaign.start_at),
  endAt: toBangkokInputValue(campaign.end_at),
  isActive: campaign.is_active,
});

/** Same checks as the backend (name ≤ 200, dates required, end not before start). */
export function validateCampaignForm(form: CampaignForm): CampaignFormErrors {
  const errors: CampaignFormErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = 'กรอกชื่อ Campaign';
  else if (name.length > 200) errors.name = 'ชื่อยาวเกิน 200 ตัวอักษร';
  const start = fromBangkokInputValue(form.startAt);
  const end = fromBangkokInputValue(form.endAt);
  if (!start || !end) errors.dates = 'เลือกวันเวลาเริ่มและสิ้นสุด';
  else if (new Date(end) < new Date(start)) errors.dates = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
  return errors;
}

export const buildCreateCampaignPayload = (form: CampaignForm): CreateCampaignPayload => ({
  name: form.name.trim(),
  start_at: fromBangkokInputValue(form.startAt),
  end_at: fromBangkokInputValue(form.endAt),
});

/**
 * PATCH body. A date goes only when its input changed: the backend rewrites the dates of every
 * mechanic, page and banner in the campaign when it gets one, and a saved `23:59:59` reads back
 * from the input as `23:59` — re-sending it would silently shift every child by 59 seconds.
 */
export function buildUpdateCampaignPayload(form: CampaignForm, original: CampaignForm): UpdateCampaignPayload {
  const payload: UpdateCampaignPayload = { name: form.name.trim(), is_active: form.isActive };
  if (form.startAt !== original.startAt) payload.start_at = fromBangkokInputValue(form.startAt);
  if (form.endAt !== original.endAt) payload.end_at = fromBangkokInputValue(form.endAt);
  return payload;
}

/** The set PUT /campaigns/:id/coupons should receive — it replaces the whole set. */
export function nextCouponIds(current: string[], change: { add: string } | { remove: string }): string[] {
  if ('add' in change) return current.includes(change.add) ? current : [...current, change.add];
  return current.filter((id) => id !== change.remove);
}

/** "เพิ่มโปร" — the mechanic editor preselects the campaign from this query. */
export const addMechanicPath = (campaignId: string) =>
  `${ADMIN_ROUTES.promotionsMechanicCreate}?campaign_id=${encodeURIComponent(campaignId)}`;

type CampaignCoupon = CampaignDetail['coupons'][number];

const HIDDEN_REASON_TEXT: Record<NonNullable<CampaignCoupon['page_hidden_reason']>, string> = {
  not_public: 'เฉพาะบุคคล',
  segment: 'เฉพาะกลุ่ม',
  inactive: 'ปิดใช้งาน',
  not_started: 'ยังไม่เริ่ม',
  expired: 'หมดอายุแล้ว',
};

/**
 * "ประเภท" of an attached coupon: targeted (non-public distribution, or limited to a segment) first,
 * then auto-apply, then plain public. A field an older backend didn't send stays unknown ("-").
 */
export function couponKindLabel(
  coupon: Pick<CampaignCoupon, 'auto_apply'> & Partial<Pick<CampaignCoupon, 'distribution_type' | 'page_hidden_reason'>>,
) {
  if (coupon.distribution_type && coupon.distribution_type !== 'public') return __uiText("เฉพาะบุคคล");
  if (coupon.page_hidden_reason === 'segment') return __uiText("เฉพาะกลุ่ม");
  if (coupon.auto_apply) return __uiText("ใช้อัตโนมัติ");
  return coupon.distribution_type === 'public' ? __uiText("สาธารณะ") : '-';
}

/**
 * Hints for the page card. The server decides per coupon (`page_hidden_reason`) and per mechanic
 * (`on_page`) whether the page lists it; a missing field (older backend) counts as listed — no false alarm.
 */
export function pageContentNotices(campaign: Pick<CampaignDetail, 'mechanics' | 'coupons'>) {
  const notices: Array<{ tone: 'warning' | 'info'; text: string }> = [];
  const hidden = campaign.coupons.filter((coupon) => coupon.page_hidden_reason);
  if (!campaign.mechanics.some((m) => m.on_page !== false) && hidden.length === campaign.coupons.length)
    notices.push({
      tone: 'warning',
      text: campaign.coupons.length
        ? 'หน้าโปรจะว่าง — ยังไม่มีโปรอัตโนมัติ และคูปองใน Campaign นี้ไม่แสดงบนหน้าโปรทั้งหมด'
        : 'หน้าโปรจะว่าง — ยังไม่มีโปรอัตโนมัติหรือคูปองใน Campaign นี้',
    });
  if (hidden.length)
    notices.push({
      tone: 'info',
      text: `คูปองเหล่านี้จะไม่แสดงบนหน้าโปร: ${hidden
        .map((c) => `${c.coupon_code} (${HIDDEN_REASON_TEXT[c.page_hidden_reason!]})`)
        .join(', ')}`,
    });
  return notices;
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data

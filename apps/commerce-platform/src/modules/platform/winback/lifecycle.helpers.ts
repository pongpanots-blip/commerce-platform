import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackLifecycle } from './winback.enums';

/** Contact-focused types used during TMP follow-up counting. */
export const TMP_CONTACT_TYPES = new Set<string>([
  'call',
  'cold_call',
  'line',
  'meeting',
  'visit',
  'store_visit',
]);

export function lifecycleAtCapture(): WinbackLifecycle {
  return WinbackLifecycle.TMP;
}

/** @deprecated Prefer lifecycleAtCapture — capture is always TMP. */
export function lifecycleFromJoshLink(_joshUserId?: string | null): WinbackLifecycle {
  return WinbackLifecycle.TMP;
}

/**
 * Promote TMP → Lead when Josh user is linked and has logged into the app.
 * Returns true when the row was mutated.
 */
export function promoteIfRegistered(
  account: WinbackAccount,
  opts?: { lastAppLoginAt?: Date | null },
): boolean {
  if (account.lifecycle === WinbackLifecycle.LEAD) return false;
  if (!account.josh_user_id) return false;
  if (!opts?.lastAppLoginAt) return false;
  account.lifecycle = WinbackLifecycle.LEAD;
  if (!account.promoted_to_lead_at) account.promoted_to_lead_at = new Date();
  return true;
}

/**
 * What a lead must have before a rep may promote it by hand: "without this, a
 * rep cannot serve this customer at all". Returned as field keys so a client
 * can point at inputs; `promoteBlockerLabel` gives the Thai wording.
 *
 * Deliberately NOT applied to `promoteIfRegistered`: a customer who registered
 * in the Josh app is the strongest signal we have, and blocking that path would
 * leave real customers stuck in `tmp` with nobody told. The two paths differ on
 * purpose; see docs/winback-api.md.
 */
export type PromoteBlocker =
  | 'company_registration_num'
  | 'id_card_number'
  | 'phone'
  | 'address'
  | 'contacts';

const PROMOTE_BLOCKER_LABEL: Record<PromoteBlocker, string> = {
  company_registration_num: 'เลขทะเบียนบริษัท',
  id_card_number: 'เลขบัตรประชาชน',
  phone: 'เบอร์โทร',
  address: 'ที่อยู่',
  contacts: 'ผู้ติดต่ออย่างน้อย 1 คน',
};

export function promoteBlockerLabel(key: PromoteBlocker): string {
  return PROMOTE_BLOCKER_LABEL[key];
}

function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function promoteBlockers(
  account: Pick<WinbackAccount, 'customer_type' | 'company_registration_num' | 'id_card_number' | 'phone' | 'address'>,
  contactCount: number,
): PromoteBlocker[] {
  const missing: PromoteBlocker[] = [];
  if (account.customer_type === 'b2b_company') {
    if (!filled(account.company_registration_num)) missing.push('company_registration_num');
  } else if (!filled(account.id_card_number)) {
    missing.push('id_card_number');
  }
  if (!filled(account.phone)) missing.push('phone');
  if (!filled(account.address)) missing.push('address');
  if (contactCount < 1) missing.push('contacts');
  return missing;
}

/** Manual confirm: sale marks "ยืนยันสมัครแอปแล้ว" without josh_user_id yet. */
export function promoteManually(account: WinbackAccount): void {
  account.lifecycle = WinbackLifecycle.LEAD;
  if (!account.promoted_to_lead_at) account.promoted_to_lead_at = new Date();
}

export function isTmpLifecycle(lifecycle: string | null | undefined): boolean {
  return lifecycle !== WinbackLifecycle.LEAD;
}

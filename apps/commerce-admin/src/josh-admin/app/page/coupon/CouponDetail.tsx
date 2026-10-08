// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  deleteCouponRewardRule,
  formatBangkokRange,
  generateCouponEntitlementsFromSegment,
  getCouponById,
  getCouponEntitlements,
  getCouponRedemptionRules,
  getCouponReport,
  getCouponRewardRules,
  notifyCouponEntitlements,
  updateCoupon,
  updateCouponEntitlementStatus,
  updateCouponRewardRule,
  uploadCouponImage,
  upsertCouponRedemptionRules,
} from '@josh/shared-api';
import { Button, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { extractApiError } from './coupon-error.helpers';
import { resolveEntitlementsPage } from './coupon-entitlements-page.helpers';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { appendReturnTo, shouldRestoreDraft } from '../../utils/return-to';
import CouponActiveSwitch from './CouponActiveSwitch';
import CouponConfirmDialog from './CouponConfirmDialog';
import CouponRewardRuleFields from './CouponRewardRuleFields';
import CouponStatusPill from './CouponStatusPill';
import { EditHistorySection } from '../promotion-common';
import { CouponCoreForm, Section } from './CouponCoreForm';
import {
  applyCouponAudienceChange,
  ChainLockedAudienceNote,
  CouponAudienceSection,
  CouponFormErrorBanner,
  CouponRedemptionSection,
} from './CouponFormSections';
import {
  audienceFormFromCoupon,
  describeCouponAudience,
  EMPTY_COUPON_AUDIENCE_FORM,
  saveCouponAudience,
  validateCouponAudienceForm,
  type CouponAudienceForm,
} from './coupon-audience.helpers';
import {
  emptyCouponCoreForm,
  formFromCoupon,
  resolveCouponFormFlags,
  couponCoreFormToPayload,
  validateCouponCoreForm,
} from './coupon-core-form.helpers';
import {
  describeRedemptionRules,
  EMPTY_COUPON_REDEMPTION_FORM,
  redemptionFormFromRules,
  redemptionFormToRules,
  validateCouponRedemptionForm,
  type CouponRedemptionForm,
} from './coupon-redemption.helpers';
import { formatSaveStepsError, runSaveSteps, type SaveStep } from './coupon-save-steps.helpers';
import {
  formatRewardRuleSummary,
  rewardFormFromRule,
  validateCouponRewardForm,
  type CouponRewardForm,
} from './coupon-reward.helpers';
import {
  consumeCouponFormDraft,
  CouponDraftStashContext,
  stashCouponFormDraft,
} from './coupon-form-draft.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type EntitlementRow = {
  id: string;
  user_id: string;
  personal_code: string | null;
  status: string;
  notified_at: string | null;
  user_email?: string | null;
  user_name?: string | null;
  user_custcode?: string | null;
};

const ENTITLEMENTS_PAGE_SIZE = 50;

function ActionButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  __useUiLocale();
  const styles =
    variant === 'primary'
      ? 'bg-gray-900 text-white hover:bg-gray-800'
      : variant === 'secondary'
        ? 'bg-white border border-gray-300 text-gray-800 hover:bg-gray-50'
        : 'text-blue-600 hover:underline bg-transparent';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

const CouponDetail = () => {
  __useUiLocale();
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [coupon, setCoupon] = useState<any>(null);
  const [form, setForm] = useState(emptyCouponCoreForm());
  const [audience, setAudience] = useState<CouponAudienceForm>(EMPTY_COUPON_AUDIENCE_FORM);
  const [audienceSegmentId, setAudienceSegmentId] = useState<string | null>(null);
  const [redemptionForm, setRedemptionForm] = useState<CouponRedemptionForm>(
    EMPTY_COUPON_REDEMPTION_FORM,
  );
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [entitlementsPage, setEntitlementsPage] = useState(1);
  // Tracks the previous entitlements.length so the page-clamp effect below can tell a reload
  // that shrank the list (reset to page 1) apart from one that grew or stayed the same.
  const prevEntitlementsCountRef = useRef(0);
  const [report, setReport] = useState<any>(null);
  const [rewardRules, setRewardRules] = useState<any[]>([]);
  /** Chains where this coupon (B) is the reward — i.e. what it takes to earn it. */
  const [incomingRules, setIncomingRules] = useState<any[]>([]);
  /** Editable per-rule form state for `incomingRules`, keyed by rule id — seeded from
   * `rewardFormFromRule()` on every `loadCoupon()` (see there). */
  const [chainRuleForms, setChainRuleForms] = useState<Record<string, CouponRewardForm>>({});
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(
    (location.state as { importSummary?: string | null } | null)?.importSummary ?? null,
  );
  const [pageError, setPageError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  // getCouponRedemptionRules failed on the last loadCoupon() — form/redemptionForm were seeded
  // from {} in that case, so saving now would upsert EMPTY redemption rules over the real ones.
  // handleSubmit refuses to save while this is true (see there); loadCoupon() clears it once
  // that fetch succeeds again.
  const [redemptionLoadFailed, setRedemptionLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [segmentMemberCount, setSegmentMemberCount] = useState<number | null>(null);
  // เปิด → ปิด เคยต้องยืนยันทันทีตอนสลับสวิตช์ — ตอนนี้พับคำเตือนไปรวมกับ save-confirm dialog
  // แทน (ดู saveConfirmOpen ด้านล่าง) กันไม่ให้แอดมินต้องยืนยัน 2 รอบสำหรับการกดคนละครั้ง
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);
  // Guards against two synchronous save-confirm clicks both entering handleSubmit — `busy`
  // (state) isn't enough on its own since state updates aren't visible until the next render,
  // so two clicks in the same tick both see busy === false. Checked synchronously.
  const submittingRef = useRef(false);
  const autoGeneratedRef = useRef(false);
  // Distinguishes "never loaded a coupon yet" (full-page not-found/error state) from "had one,
  // a later reload failed" (keep showing the page, just note the failure) — see loadCoupon().
  const hasCouponRef = useRef(false);

  const handleActiveSwitchChange = (nextIsActive: boolean) => {
    setForm((current) => ({ ...current, is_active: nextIsActive }));
  };

  const { isNewSignupCoupon, effectiveDistributionType } = resolveCouponFormFlags(audience.mode);

  const handleAudienceChange = (next: CouponAudienceForm) =>
    applyCouponAudienceChange(next, setAudience, setForm);

  /** Reward rules only (rewardRules + incomingRules + chainRuleForms) — used after unlinking a
   * chain rule, so that action doesn't reload (and so discard) unsaved core/audience/redemption
   * edits the way a full loadCoupon() would. Returns any failure notices instead of setting
   * pageError itself, so callers can combine them with their own context. Never throws. */
  const loadRewardRules = useCallback(async (): Promise<string[]> => {
    if (!id) return [];
    const [rewardRes, incomingRes] = await Promise.allSettled([
      getCouponRewardRules(id),
      getCouponRewardRules(id, { as: 'reward' }),
    ]);

    const notices: string[] = [];

    if (rewardRes.status === 'fulfilled') {
      setRewardRules(rewardRes.value.data?.data ?? []);
    } else {
      notices.push('โหลดคูปองต่อเนื่อง (ที่ได้รับหลังใช้คูปองนี้) ไม่สำเร็จ');
    }

    if (incomingRes.status === 'fulfilled') {
      // Defensive filter in case an older backend build ignores `?as=reward` and just
      // returns this coupon's own outgoing rules instead.
      const rows = (incomingRes.value.data?.data ?? []).filter(
        (rule: { reward_coupon_id: string }) => rule.reward_coupon_id === id,
      );
      setIncomingRules(rows);
      setChainRuleForms(
        Object.fromEntries(
          rows.map((rule: {
            id: string;
            grant_timing: string;
            delay_days?: number | string | null;
            reward_per_user_limit?: number | string | null;
          }) => [rule.id, rewardFormFromRule(rule)]),
        ),
      );
    } else {
      notices.push('โหลดคูปองต่อเนื่อง (เงื่อนไขที่ต้องทำก่อนได้รับคูปองนี้) ไม่สำเร็จ');
    }

    return notices;
  }, [id]);

  /** Coupon + form + redemption + reward rules + audience + segment count. Used on mount and
   * after save — never after a notify/generate/status/unlink action, so those can't wipe an
   * admin's unsaved form edits (see loadEntitlements()/loadRewardRules() above/below). */
  const loadCoupon = useCallback(async () => {
    if (!id) return;
    let couponRecord: any;
    try {
      const couponRes = await getCouponById(id);
      couponRecord = couponRes.data?.data ?? null;
    } catch (error: unknown) {
      if (!hasCouponRef.current) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          setNotFound(true);
          setLoadError('');
        } else {
          setNotFound(false);
          setLoadError(extractApiError(error, 'โหลดคูปองไม่สำเร็จ'));
        }
      } else {
        // Already showing a coupon from an earlier load — don't blow the page away over a
        // reload hiccup, just flag it.
        setPageError(__uiMessage("โหลดข้อมูลคูปองใหม่ไม่สำเร็จ: {0}",{"0":extractApiError(error)}));
      }
      return;
    }

    hasCouponRef.current = true;
    setNotFound(false);
    setLoadError('');
    setCoupon(couponRecord);

    const [rulesRes, rewardNotices] = await Promise.all([
      getCouponRedemptionRules(id).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      ),
      loadRewardRules(),
    ]);

    const notices: string[] = [...rewardNotices];

    const rulesRecord =
      rulesRes.status === 'fulfilled'
        ? ((rulesRes.value.data?.data ?? {}) as Record<string, unknown>)
        : {};
    setRedemptionLoadFailed(rulesRes.status === 'rejected');
    if (rulesRes.status === 'rejected') notices.push('โหลดเงื่อนไขใช้โค้ดไม่สำเร็จ');

    setForm(formFromCoupon(couponRecord, rulesRecord));
    setRedemptionForm(
      redemptionFormFromRules(rulesRecord, Number(couponRecord?.minimum_order_amount ?? 0)),
    );

    if (notices.length > 0) {
      setPageError(notices.join(' · '));
    }

    // Preserve any not-yet-saved recipient input (file/paste box) — a reload here must not
    // wipe what the admin is mid-typing.
    setAudience((prev) => ({
      ...audienceFormFromCoupon(couponRecord),
      recipientText: prev.recipientText,
      recipientFile: prev.recipientFile,
    }));

    if (couponRecord?.audience_segment_id) {
      setAudienceSegmentId(couponRecord.audience_segment_id);
      setSegmentMemberCount(null);
    } else {
      setAudienceSegmentId(null);
      setSegmentMemberCount(null);
    }
  }, [id, loadRewardRules]);

  /** Entitlements + report only. Used after notify-all, notify-one, generate-from-segment and
   * the entitlement status toggle — none of those touch the coupon/audience/redemption/chain
   * forms, so this must not reload (and so overwrite) any of that. */
  const loadEntitlements = useCallback(async () => {
    if (!id) return;
    try {
      const [entRes, reportRes] = await Promise.all([
        getCouponEntitlements(id),
        getCouponReport(id),
      ]);
      setEntitlements(entRes.data?.data ?? []);
      setReport(reportRes.data?.data ?? null);
    } catch (error: unknown) {
      setPageError(extractApiError(error, 'โหลดรายชื่อผู้มีสิทธิ์ไม่สำเร็จ'));
    }
  }, [id]);

  useEffect(() => {
    // Guards against StrictMode's dev double-invoke (mount → cleanup → mount): without this,
    // the first (phantom) run's loadCoupon() call can still resolve and setState after the
    // second (live) run has already restored the draft, clobbering it. Only the run that is
    // still "live" once its own load finishes proceeds past this point.
    let cancelled = false;
    void (async () => {
      await Promise.all([loadCoupon(), loadEntitlements()]);
      if (cancelled) return;
      setLoading(false);
      // Restore a draft stashed on the way out to a segment/product-set page (see
      // coupon-form-draft.helpers.ts) — applied AFTER the server load above so it isn't
      // immediately overwritten by loadCoupon()'s own setForm/setAudience/setRedemptionForm.
      // Gated on the `restoreDraft` marker (return-to.ts) so an unrelated visit to this page
      // never resurrects an old draft; the marker is cleared (replace nav) either way so a
      // refresh afterwards doesn't re-trigger this.
      if (!shouldRestoreDraft(searchParams)) return;
      navigate(location.pathname, { replace: true });
      const draft = consumeCouponFormDraft<{
        form: typeof form;
        audience: CouponAudienceForm;
        redemptionForm: CouponRedemptionForm;
      }>(location.pathname);
      if (!draft || cancelled) return;
      setForm(draft.form);
      setAudience(draft.audience);
      setRedemptionForm(draft.redemptionForm);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCoupon, loadEntitlements]);

  // Stashed explicitly by the two out-links that leave this page (the "แก้ไข segment ขั้นสูง"
  // link below and, via CouponDraftStashContext, PromotionProductSetPicker's "จัดการ Promotion
  // Product Set" link nested under CouponRedemptionSection) on their own onClick — never from a
  // global listener, so only those links can stash.
  const stashDraft = () =>
    stashCouponFormDraft(location.pathname, { form, audience, redemptionForm });

  // Keep the entitlement table's page in range whenever the (already fully-loaded) list
  // changes size — see coupon-entitlements-page.helpers.ts for the reset-on-shrink rule.
  useEffect(() => {
    setEntitlementsPage((page) =>
      resolveEntitlementsPage(
        page,
        prevEntitlementsCountRef.current,
        entitlements.length,
        ENTITLEMENTS_PAGE_SIZE,
      ),
    );
    prevEntitlementsCountRef.current = entitlements.length;
  }, [entitlements.length]);

  // The create-page's post-save summary arrives via router state — read it once, then drop it
  // so it doesn't reappear on refresh or browser back.
  useEffect(() => {
    if (location.state) {
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerateFromSegment = async (silent = false) => {
    setBusy(true);
    setPageError('');
    try {
      const response = await generateCouponEntitlementsFromSegment(id, {
        activate: true,
      });
      const created = response.data?.data?.created ?? 0;
      const matched = response.data?.data?.matchedUsers ?? 0;
      setImportSummary(
        `สร้างรายชื่อจากกลุ่มแล้ว ${created} รายการ (ตรงเงื่อนไข ${matched} คน)`,
      );
      await loadEntitlements();
    } catch (error: unknown) {
      autoGeneratedRef.current = false;
      if (!silent) {
        setPageError(extractApiError(error, 'สร้างรายชื่อจากกลุ่มไม่สำเร็จ'));
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (loading || busy || autoGeneratedRef.current) return;
    if (!audienceSegmentId || entitlements.length > 0) return;
    if (audience.mode !== 'segment') return;

    autoGeneratedRef.current = true;
    void handleGenerateFromSegment(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, busy, audienceSegmentId, entitlements.length, audience.mode]);

  const handleNotifyAll = async () => {
    setBusy(true);
    setPageError('');
    try {
      const response = await notifyCouponEntitlements(id, {
        message: `คุณได้รับคูปอง ${coupon?.title ?? ''} รหัส ${coupon?.coupon_code ?? ''}`,
      });
      const sent = response.data?.data?.sent ?? 0;
      setImportSummary(`แจ้งเตือนแล้ว ${sent} คน`);
      await loadEntitlements();
    } catch (error: unknown) {
      setPageError(extractApiError(error, 'แจ้งเตือนไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const handleNotifyOne = async (entitlementId: string) => {
    setBusy(true);
    setPageError('');
    try {
      await notifyCouponEntitlements(id, {
        entitlement_ids: [entitlementId],
        message: `คุณได้รับคูปอง ${coupon?.title ?? ''}`,
      });
      await loadEntitlements();
    } catch (error: unknown) {
      setPageError(extractApiError(error, 'แจ้งเตือนไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEntitlementStatus = async (
    entitlementId: string,
    nextStatus: 'active' | 'inactive',
  ) => {
    setBusy(true);
    setPageError('');
    try {
      await updateCouponEntitlementStatus(id, entitlementId, nextStatus);
      await loadEntitlements();
    } catch (error: unknown) {
      setPageError(extractApiError(error, 'อัปเดตสถานะสิทธิ์ไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlinkChainRule = async (ruleId: string) => {
    if (!window.confirm(__uiText("ยกเลิกการเชื่อมคูปองต่อเนื่องนี้?"))) return;
    setBusy(true);
    setPageError('');
    try {
      await deleteCouponRewardRule(ruleId);
      // Reward rules only — a full loadCoupon() here would discard any unsaved core/audience/
      // redemption edits the admin was mid-typing.
      const notices = await loadRewardRules();
      if (notices.length > 0) setPageError(notices.join(' · '));
    } catch (error: unknown) {
      setPageError(extractApiError(error, 'ยกเลิกการเชื่อม Chain ไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  /** The pure form-field checks that must pass before the save-confirm dialog is even shown —
   * shared by handleSaveClick (gates opening the dialog) and handleSubmit (re-checked once more
   * right before the actual save, since it's cheap and the dialog is the only caller). */
  const validateCouponFormForSave = (): string | null => {
    const coreValidation = validateCouponCoreForm(form, coupon);
    if (coreValidation.formError) return coreValidation.formError;

    const audienceError = validateCouponAudienceForm(audience);
    if (audienceError) return audienceError;

    const redemptionError = validateCouponRedemptionForm(redemptionForm, form.discount_scope);
    if (redemptionError) return redemptionError;

    // The last load of the real redemption rules failed — form/redemptionForm were seeded from
    // {} instead, so saving now would upsert EMPTY rules over whatever the coupon actually has.
    if (redemptionLoadFailed) {
      return 'โหลดเงื่อนไขใช้โค้ดไม่สำเร็จ — กดโหลดใหม่ก่อนบันทึก เพื่อไม่ให้เงื่อนไขเดิมถูกเขียนทับ';
    }

    return null;
  };

  /** Code-lock + chain-rule checks — need `payload`/`incomingRules`/`chainRuleForms`, so kept
   * separate from validateCouponFormForSave (pure field checks), but still run from
   * handleSaveClick before the dialog opens, so these errors surface there too instead of only
   * after confirming. handleSubmit re-derives `changedChainRules` itself for the actual save. */
  const validateChainAndCodeLock = (): string | null => {
    const payload = couponCoreFormToPayload(form, { effectiveDistributionType, isNewSignupCoupon });

    // A code_locked coupon 409s on the backend if code_generation changes — the audience mode
    // picked here can force that change under the hood (couponCoreFormToPayload always sends
    // 'shared' for the 'all' audience) without the admin touching the code toggle at all. Catch
    // it before any request so the error names the real cause instead of a generic API message.
    if (coupon.code_locked && payload.code_generation !== coupon.code_generation) {
      return 'คูปองนี้ถูกแจกหรือใช้งานแล้ว เปลี่ยนรหัสคูปองหรือรูปแบบรหัสไม่ได้ — กลุ่มเป้าหมายที่เลือกไว้จะเปลี่ยนรูปแบบรหัส (code_generation) จึงบันทึกไม่ได้ เลือกกลุ่มเป้าหมายอื่นที่ไม่เปลี่ยนรูปแบบรหัส';
    }

    // Chain rules (this coupon as B) whose editable fields actually changed from what's loaded.
    for (const rule of incomingRules) {
      const current = chainRuleForms[rule.id];
      if (!current) continue;
      const original = rewardFormFromRule(rule);
      const changed =
        current.grant_timing !== original.grant_timing ||
        current.delay_days !== original.delay_days ||
        current.reward_per_user_limit !== original.reward_per_user_limit;
      if (!changed) continue;
      const chainError = validateCouponRewardForm(current);
      if (chainError) return chainError;
    }

    return null;
  };

  /** Wired to AdminInsertLayout's onSave — validates first so the confirm dialog never opens
   * just to be immediately followed by a validation error underneath it. */
  const handleSaveClick = () => {
    const validationError = validateCouponFormForSave() ?? validateChainAndCodeLock();
    if (validationError) {
      setPageError(validationError);
      return;
    }
    setPageError('');
    setSaveConfirmOpen(true);
  };

  /** Mirrors CreateCoupon's handleSubmit: coupon core -> image -> redemption rules -> audience
   * -> (this coupon's own) chain rule updates, run as tracked steps (`runSaveSteps`) so a
   * failure partway through reports exactly what saved and what didn't, instead of a generic
   * failure message that hides the earlier steps that actually persisted. On failure, nothing
   * is reset/reloaded — every unsaved form value stays as the admin left it, and re-saving is
   * safe (every step is an idempotent PATCH/PUT). Only ever called from the save-confirm
   * dialog's onConfirm (handleSaveClick above gates opening it and its errors). Guarded by
   * `submittingRef` against two synchronous confirm clicks both entering this function before
   * `busy` (state) has had a chance to re-render and disable the dialog's buttons. */
  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setPageError('');

      const validationError = validateCouponFormForSave() ?? validateChainAndCodeLock();
      if (validationError) {
        setPageError(validationError);
        return;
      }

      const minCartAmount = Number(redemptionForm.minCartAmount) || 0;
      const payload = {
        ...couponCoreFormToPayload(form, { effectiveDistributionType, isNewSignupCoupon }),
        minimum_order_amount: minCartAmount,
      };

      // Chain rules (this coupon as B) whose editable fields actually changed from what's
      // loaded — re-derived here (validateChainAndCodeLock above already checked they're valid)
      // since handleSubmit needs the actual list of rules to save, not just a pass/fail.
      const changedChainRules: Array<{ ruleId: string; form: CouponRewardForm }> = [];
      for (const rule of incomingRules) {
        const current = chainRuleForms[rule.id];
        if (!current) continue;
        const original = rewardFormFromRule(rule);
        const changed =
          current.grant_timing !== original.grant_timing ||
          current.delay_days !== original.delay_days ||
          current.reward_per_user_limit !== original.reward_per_user_limit;
        if (!changed) continue;
        changedChainRules.push({ ruleId: rule.id, form: current });
      }

      setBusy(true);
      try {
        let recipientImportSummary: string | null = null;
        const steps: SaveStep[] = [
          { label: __uiText("ข้อมูลคูปอง"), run: () => updateCoupon(id, payload) },
        ];

        if (pendingImageFile) {
          const imageFile = pendingImageFile;
          steps.push({
            label: 'รูปภาพ',
            run: async () => {
              await uploadCouponImage(id, imageFile);
              setPendingImageFile(null);
            },
          });
        }

        steps.push({
          label: 'เงื่อนไขใช้โค้ด',
          run: () =>
            upsertCouponRedemptionRules(
              id,
              redemptionFormToRules(redemptionForm, form.discount_scope),
              redemptionForm.refreshProductSetIds,
            ),
        });

        steps.push({
          label: 'กลุ่มเป้าหมาย',
          run: async () => {
            const result = await saveCouponAudience(id, audience, {
              autoGenerateEntitlements: audience.mode === 'segment',
            });
            recipientImportSummary = result.importSummary;
          },
        });

        if (changedChainRules.length > 0) {
          steps.push({
            label: 'เงื่อนไขคูปองต่อเนื่อง',
            run: async () => {
              for (const { ruleId, form: ruleForm } of changedChainRules) {
                await updateCouponRewardRule(ruleId, {
                  grant_timing: ruleForm.grant_timing,
                  delay_days: Number(ruleForm.delay_days) || 0,
                  reward_per_user_limit: Number(ruleForm.reward_per_user_limit) || 1,
                });
              }
            },
          });
        }

        const result = await runSaveSteps(steps);
        if (result.failed) {
          setPageError(formatSaveStepsError(result));
          return;
        }

        setImportSummary(
          recipientImportSummary ??
            `บันทึกคูปองแล้ว — ${describeCouponAudience(audience)} · ${describeRedemptionRules(redemptionForm, form.discount_scope)}`,
        );
        setAudience((current) => ({ ...current, recipientText: '', recipientFile: null }));
        // Save can import recipients / generate from segment — refresh the entitlement table too.
        await Promise.all([loadCoupon(), loadEntitlements()]);
      } finally {
        setBusy(false);
      }
    } finally {
      submittingRef.current = false;
    }
  };

  if (loading && !coupon) {
    return <div className="p-6">{__uiText("กำลังโหลด…")}</div>;
  }

  if (!coupon) {
    if (notFound) {
      return <div className="p-6">{__uiText("ไม่พบคูปอง")}</div>;
    }
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-600">{loadError || __uiText("โหลดคูปองไม่สำเร็จ")}</p>
        <ActionButton
          variant="secondary"
          onClick={() => {
            void loadCoupon();
            void loadEntitlements();
          }}
        >
          {__uiText("ลองอีกครั้ง")}</ActionButton>
      </div>
    );
  }

  // Locked while this coupon is the reward (B) of at least one still-linked chain and its
  // audience is still the manual mode saveCouponAudience sets on chain creation — an admin
  // cannot flip the mode by hand while a chain rule points at this coupon, because the locked
  // note below replaces the mode fields entirely. Unlinking the chain (the "ยกเลิกการเชื่อม
  // Chain" button on each rule below) removes the last incoming rule and this reverts to the
  // normal, editable audience fields.
  const isChainTarget = incomingRules.length > 0 && audience.mode === 'manual';
  const lockedAudienceNote = isChainTarget ? (
    <ChainLockedAudienceNote
      sourceLabel={incomingRules
        .map((rule) =>
          rule.source_coupon
            ? `${rule.source_coupon.coupon_code} — ${rule.source_coupon.title}`
            : 'คูปองต้นทาง',
        )
        .join(', ')}
    />
  ) : undefined;

  const pendingNotifyCount = entitlements.filter((row) => !row.notified_at).length;

  // ponytail: all entitlements are still fetched in one request (getCouponEntitlements) —
  // this only paginates the already-loaded array client-side. Move to server-side paging on
  // `GET /coupon/:id/entitlements` (page/limit params) if that payload becomes the bottleneck.
  const entitlementsTotalPages = Math.max(
    1,
    Math.ceil(entitlements.length / ENTITLEMENTS_PAGE_SIZE),
  );
  const pagedEntitlements = entitlements.slice(
    (entitlementsPage - 1) * ENTITLEMENTS_PAGE_SIZE,
    entitlementsPage * ENTITLEMENTS_PAGE_SIZE,
  );
  const entitlementColumns: TableColumn<EntitlementRow>[] = [
    {
      key: 'user',
      label: __uiText("ผู้ใช้"),
      render: (_value, row) => (
        <div>
          <div className="font-medium text-gray-900">
            {row.user_name ?? row.user_email ?? row.user_id}
          </div>
          <div className="text-xs text-gray-500">
            {[row.user_email, row.user_custcode, row.user_id].filter(Boolean).join(' · ')}
          </div>
        </div>
      ),
    },
    {
      key: 'personal_code',
      label: __uiText("โค้ด"),
      render: (value) => (
        <span className="font-mono text-xs">{value ?? coupon.coupon_code}</span>
      ),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            value === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {value}
        </span>
      ),
    },
    {
      key: 'notified_at',
      label: __uiText("แจ้งแล้ว"),
      render: (value) => (
        <span className="text-xs text-gray-600">
          {value ? new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : __uiText("ยังไม่แจ้ง")}
        </span>
      ),
    },
    {
      key: 'actions',
      label: __uiText("จัดการ"),
      render: (_value, row) => (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            title={__uiText("ส่งแจ้งเตือนในแอปให้คนนี้")}
            aria-label={__uiText("แจ้ง")}
            onClick={() => void handleNotifyOne(row.id)}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-primary transition-colors disabled:opacity-50"
          >
            {__uiText("แจ้ง")}</button>
          <button
            type="button"
            disabled={busy}
            title={row.status === 'active' ? __uiText("ปิดสิทธิ์นี้") : __uiText("เปิดสิทธิ์นี้")}
            aria-label={row.status === 'active' ? __uiText("ปิด") : __uiText("เปิด")}
            onClick={() =>
              void handleToggleEntitlementStatus(
                row.id,
                row.status === 'active' ? 'inactive' : 'active',
              )
            }
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-primary transition-colors disabled:opacity-50"
          >
            {row.status === 'active' ? __uiText("ปิด") : __uiText("เปิด")}
          </button>
        </div>
      ),
    },
  ];

  const discountSummary =
    coupon.discount_type === 'PERCENTAGE'
      ? `${coupon.discount_value}%`
      : `${coupon.discount_value} บาท`;
  const subtitle =
    `${coupon.distribution_type} · ${coupon.coupon_type} · ${discountSummary} · ` +
    `ใช้ได้ ${formatBangkokRange(coupon.start_date, coupon.end_date, 'th')} (เวลาไทย) · ` +
    describeCouponAudience(audience);

  // Folded into the save-confirm dialog body below instead of a separate toggle-time popup —
  // see the comment on saveConfirmOpen's declaration.
  const willDisableOnSave = coupon.is_active && !form.is_active;

  return (
    <CouponDraftStashContext.Provider value={stashDraft}>
    <AdminInsertLayout
      title={`${coupon.coupon_code} — ${coupon.title}`}
      subtitle={subtitle}
      saveLabel="บันทึกคูปอง"
      backPath={ADMIN_ROUTES.coupons}
      saving={busy}
      wide
      headerActions={
        <>
          <CouponStatusPill coupon={coupon} />
          <CouponActiveSwitch
            checked={form.is_active}
            disabled={busy}
            onChange={handleActiveSwitchChange}
          />
        </>
      }
      onSave={handleSaveClick}
      onBack={() => setBackConfirmOpen(true)}
    >
      <CouponConfirmDialog
        open={saveConfirmOpen}
        title={__uiText("บันทึกการแก้ไขคูปองนี้?")}
        body={
          <>
            <p>
              {describeCouponAudience(audience)} ·{' '}
              {describeRedemptionRules(redemptionForm, form.discount_scope)}
            </p>
            {willDisableOnSave && (
              <p className="mt-2 font-medium text-alert">
                {__uiText("คูปองนี้จะถูกปิดใช้งานทันทีหลังบันทึก ลูกค้าจะใช้ไม่ได้จนกว่าจะเปิดอีกครั้ง")}</p>
            )}
          </>
        }
        confirmLabel="บันทึก"
        tone={willDisableOnSave ? 'danger' : 'primary'}
        busy={busy}
        onCancel={() => setSaveConfirmOpen(false)}
        onConfirm={() => {
          void (async () => {
            await handleSubmit();
            setSaveConfirmOpen(false);
          })();
        }}
      />
      <CouponConfirmDialog
        open={backConfirmOpen}
        title={__uiText("ออกจากหน้านี้?")}
        body="การแก้ไขที่ยังไม่บันทึกจะหายไป"
        confirmLabel="ออกจากหน้านี้"
        tone="danger"
        onCancel={() => setBackConfirmOpen(false)}
        onConfirm={() => navigate(ADMIN_ROUTES.coupons)}
      />

      <CouponFormErrorBanner error={pageError} />

      {redemptionLoadFailed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            {__uiText("โหลดเงื่อนไขใช้โค้ดไม่สำเร็จ — บันทึกตอนนี้จะเขียนทับเงื่อนไขเดิมด้วยค่าว่าง กดโหลดใหม่ก่อนบันทึก")}</span>
          <ActionButton variant="secondary" disabled={busy} onClick={() => void loadCoupon()}>
            {__uiText("โหลดใหม่")}</ActionButton>
        </div>
      )}

      {importSummary ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {importSummary}
        </div>
      ) : null}

      {incomingRules.length > 0 && (
        <Section title={__uiText("รูปแบบคูปอง")} description={__uiText("คูปองต่อเนื่อง (Chain)")}>
          <ul className="space-y-3 text-sm">
            {incomingRules.map((rule) => (
              <li key={rule.id} className="space-y-3 rounded-lg border border-gray-100 p-3">
                <p className="font-medium text-gray-900 flex flex-wrap items-center gap-2">
                  <span>
                    {__uiText("ต้องใช้")}{' '}
                    <Link
                      to={ADMIN_ROUTES.couponDetail(rule.source_coupon_id)}
                      className="text-blue-600 hover:underline"
                    >
                      {rule.source_coupon
                        ? `${rule.source_coupon.coupon_code} — ${rule.source_coupon.title}`
                        : __uiText("คูปองต้นทาง")}
                    </Link>{' '}
                    {__uiText("ก่อน")}</span>
                  {rule.source_coupon && <CouponStatusPill coupon={rule.source_coupon} />}
                </p>
                <CouponRewardRuleFields
                  value={chainRuleForms[rule.id] ?? rewardFormFromRule(rule)}
                  onChange={(next) =>
                    setChainRuleForms((current) => ({ ...current, [rule.id]: next }))
                  }
                  disabled={busy}
                />
                <ActionButton
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void handleUnlinkChainRule(rule.id)}
                >
                  {__uiText("ยกเลิกการเชื่อม Chain")}</ActionButton>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <CouponCoreForm
        form={form}
        onChange={setForm}
        disabled={busy}
        formError={pageError}
        pendingImageFile={pendingImageFile}
        onPendingImageFileChange={setPendingImageFile}
        imageUrl={coupon.image_url}
        codeLocked={coupon.code_locked}
        originalCoupon={coupon}
        audienceIsPublic={effectiveDistributionType === 'public'}
        audienceSection={
          <CouponAudienceSection
            audience={audience}
            onAudienceChange={handleAudienceChange}
            disabled={busy}
            codeGeneration={form.code_generation}
            onCodeGenerationChange={(code_generation) =>
              setForm((current) => ({ ...current, code_generation }))
            }
            lockedNote={lockedAudienceNote}
            codeGenerationLocked={coupon.code_locked}
          >
            {audienceSegmentId && (
              <Link
                to={appendReturnTo(
                  ADMIN_ROUTES.segmentEdit(audienceSegmentId),
                  location.pathname,
                )}
                onClick={stashDraft}
                className="text-xs text-blue-600 hover:underline"
              >
                {__uiText("แก้ไข segment ขั้นสูง")}</Link>
            )}
            {audience.mode === 'segment' && (
              <p className="text-xs text-gray-500">
                {__uiText("หลังบันทึก ระบบจะ")}<strong>{__uiText("สร้างรายชื่ออัตโนมัติ")}</strong>{__uiText("จากกลุ่มเป้าหมาย")}{segmentMemberCount != null ? __uiText(" (ประมาณ {0} คน)", {"0": segmentMemberCount}) : ''}
              </p>
            )}

            {!(audience.mode === 'all' && entitlements.length === 0) && (
              <div className="space-y-3 border-t border-gray-100 pt-4">
                <h3 className="text-sm font-medium text-gray-800">
                  {__uiText("รายชื่อผู้มีสิทธิ์ (")}{entitlements.length})
                </h3>

                <div className="flex flex-wrap items-center gap-2">
                  {audience.mode === 'segment' && (
                    <span title={__uiText("ดึงสมาชิกใหม่ของ segment เข้ามาเพิ่มในรายชื่อ")}>
                      <Button
                        variant="secondary"
                        onClick={() => void handleGenerateFromSegment()}
                        disabled={busy || !audienceSegmentId}
                      >
                        {__uiText("สร้างรายชื่อจากกลุ่ม")}{segmentMemberCount != null ? __uiText(" ({0} คน)", {"0": segmentMemberCount}) : ''}
                      </Button>
                    </span>
                  )}
                  <span title={__uiText("ส่งแจ้งเตือนในแอปให้ทุกคนที่ยังไม่เคยได้รับ")}>
                    <Button
                      variant="primary"
                      onClick={handleNotifyAll}
                      disabled={busy || pendingNotifyCount === 0}
                    >
                      {pendingNotifyCount === 0
                        ? __uiText("แจ้งเตือนครบแล้ว")
                        : __uiText("แจ้งเตือนทั้งหมด ({0})", {"0": pendingNotifyCount})}
                    </Button>
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  {__uiText("สร้างรายชื่อจากกลุ่ม = ดึงสมาชิกใหม่ของ segment เข้ามาเพิ่ม · แจ้งเตือนทั้งหมด = ส่งแจ้งเตือนในแอปให้คนที่ยังไม่ได้รับ")}</p>

                {audienceSegmentId &&
                  entitlements.length === 0 &&
                  audience.mode === 'segment' && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {__uiText("มีกลุ่มเป้าหมายแล้วแต่ยังไม่มีรายชื่อ — ระบบจะสร้างให้อัตโนมัติ")}{segmentMemberCount != null ? __uiText(" (ประมาณ {0} คน)", {"0": segmentMemberCount}) : ''}
                      {' · '}
                      <button
                        type="button"
                        className="font-medium text-amber-950 underline"
                        disabled={busy}
                        onClick={() => void handleGenerateFromSegment()}
                      >
                        {__uiText("สร้างรายชื่อตอนนี้")}</button>
                    </div>
                  )}

                {entitlements.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
                    {isChainTarget
                      ? __uiText("ยังไม่มีผู้ได้รับ — ระบบจะมอบให้อัตโนมัติเมื่อลูกค้าใช้คูปองต้นทางสำเร็จ")
                      : audience.mode === 'manual'
                        ? __uiText("ยังไม่มีรายชื่อ — เพิ่มรายชื่อด้านบน แล้วกดบันทึก")
                        : audienceSegmentId
                          ? __uiText("กำลังสร้างรายชื่อจากกลุ่มเป้าหมาย… หรือกดปุ่มด้านบน")
                          : __uiText("ยังไม่มีรายชื่อ — เลือกโหมดกลุ่มเป้าหมายด้านบนก่อน")}
                  </div>
                ) : (
                  <Table
                    columns={entitlementColumns}
                    data={pagedEntitlements}
                    idKey="id"
                    totalItems={entitlements.length}
                    currentPage={entitlementsPage}
                    totalPages={entitlementsTotalPages}
                    pageSize={ENTITLEMENTS_PAGE_SIZE}
                    onPageChange={setEntitlementsPage}
                    bodyMaxHeightClassName="max-h-[28rem]"
                  />
                )}
              </div>
            )}
          </CouponAudienceSection>
        }
        redemptionSection={
          <CouponRedemptionSection
            value={redemptionForm}
            onChange={setRedemptionForm}
            discountScope={form.discount_scope}
            onDiscountScopeChange={(discount_scope) =>
              setForm((current) => ({ ...current, discount_scope }))
            }
            disabled={busy}
          />
        }
      />

      {rewardRules.length > 0 && (
        <Section
          title={__uiText("คูปองต่อเนื่อง (Chain)")}
          description={__uiText("เพิ่มคูปองต่อเนื่องใหม่ได้ที่หน้าเพิ่ม Coupon → รูปแบบ \"คูปองต่อเนื่อง (Chain)\"")}
        >
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-800">
              {__uiText("เมื่อใช้คูปองนี้สำเร็จ ลูกค้าจะได้รับ")}</h3>
            <ul className="space-y-2 text-sm">
              {rewardRules.map((rule) => (
                <li key={rule.id} className="rounded-lg border border-gray-100 p-3">
                  <p className="font-medium text-gray-900 flex flex-wrap items-center gap-2">
                    <span>
                      <Link
                        to={ADMIN_ROUTES.couponDetail(rule.reward_coupon_id)}
                        className="text-blue-600 hover:underline"
                      >
                        {rule.reward_coupon
                          ? `${rule.reward_coupon.coupon_code} — ${rule.reward_coupon.title}`
                          : __uiText("คูปองรางวัล")}
                      </Link>{' '}
                      · {formatRewardRuleSummary(rule)}
                    </span>
                    {rule.reward_coupon && <CouponStatusPill coupon={rule.reward_coupon} />}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-500">
              {__uiText("แก้ไขเงื่อนไขการได้รับ (เวลามอบ/หน่วงใช้ได้/จำนวนครั้งสูงสุด) ได้ที่หน้ารายละเอียดของคูปองรางวัลแต่ละใบ")}</p>
          </div>
        </Section>
      )}

      {report && (
        <Section title={__uiText("รายงาน")}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Stat label={__uiText("สิทธิ์ทั้งหมด")} value={report.totalEntitlements} />
            <Stat label={__uiText("ใช้แล้ว")} value={report.usageCount} />
            <Stat label={__uiText("ส่วนลดที่ใช้")} value={report.totalDiscountApplied} />
            <Stat label={__uiText("แจ้งแล้ว")} value={report.notifiedCount} />
          </div>
        </Section>
      )}

      <EditHistorySection entityType="coupon" entityId={id} refreshKey={coupon} />
    </AdminInsertLayout>
    </CouponDraftStashContext.Provider>
  );
};

function Stat({ label, value }: { label: string; value: number }) {
  __useUiLocale();
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{Number(value).toLocaleString()}</div>
    </div>
  );
}

/** `key={id}` forces a full remount of `CouponDetail` on every id change — the route itself
 * (`/coupon/:id` in app.tsx) has no key, so navigating B → A via an in-page link (e.g. the
 * chain source link) would otherwise reuse the mounted component: the old form would stay
 * visible under the new id (a Save would PATCH the old values onto the new coupon), and
 * `hasCouponRef`/`notFound`/`loadError` would carry over from the previous coupon too. */
function CouponDetailPage() {
  __useUiLocale();
  const { id = '' } = useParams();
  return <CouponDetail key={id} />;
}

export default CouponDetailPage;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

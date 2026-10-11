import {
  createCoupon,
  createCouponRewardRule,
  getCouponById,
  getCouponRedemptionRules,
  updateCoupon,
  uploadCouponImage,
  upsertCouponRedemptionRules,
} from '@josh/shared-api';
import { extractApiError } from './coupon-error.helpers';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Select } from '@josh/shared-ui-web';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { shouldRestoreDraft } from '../../utils/return-to';
import CouponActiveSwitch from './CouponActiveSwitch';
import { CouponCoreForm, FieldLabel, Section } from './CouponCoreForm';
import CouponRewardRuleFields from './CouponRewardRuleFields';
import {
  applyCouponAudienceChange,
  ChainLockedAudienceNote,
  CouponAudienceSection,
  CouponFormErrorBanner,
  CouponRedemptionSection,
} from './CouponFormSections';
import {
  audienceFormFromCoupon,
  EMPTY_COUPON_AUDIENCE_FORM,
  saveCouponAudience,
  validateCouponAudienceForm,
  type CouponAudienceForm,
} from './coupon-audience.helpers';
import {
  couponCoreFormToPayload,
  defaultCouponDateRange,
  emptyCouponCoreForm,
  formFromCoupon,
  resolveCouponFormFlags,
  validateCouponCoreForm,
  type CouponCoreForm as CouponCoreFormState,
} from './coupon-core-form.helpers';
import {
  EMPTY_COUPON_REDEMPTION_FORM,
  redemptionFormFromRules,
  redemptionFormToRules,
  validateCouponRedemptionForm,
  type CouponRedemptionForm,
} from './coupon-redemption.helpers';
import { runSaveSteps, type SaveStep } from './coupon-save-steps.helpers';
import {
  couponRewardFormToPayload,
  EMPTY_COUPON_REWARD_FORM,
  loadCouponOptions,
  validateCouponRewardForm,
  type CouponOption,
  type CouponRewardForm,
} from './coupon-reward.helpers';
import {
  CouponDraftStashContext,
  dataUrlToFile,
  discardCouponFormDraft,
  fileToDataUrl,
  peekCouponFormDraft,
  stashCouponFormDraft,
  type CouponPendingImage,
} from './coupon-form-draft.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type CouponKind = 'normal' | 'chain';

type CouponCreateDraft = {
  form: CouponCoreFormState;
  audience: CouponAudienceForm;
  redemption: CouponRedemptionForm;
  kind: CouponKind;
  chainSourceId: string;
  rewardForm: CouponRewardForm;
  createdCouponId: string | null;
  /** Chosen-but-not-yet-uploaded image, kept as a data URL (set async at selection time — see
   * handlePendingImageFileChange below) so it survives a stash/restore round-trip. */
  pendingImage: CouponPendingImage | null;
  /** Preview URL for an image that already finished uploading in an earlier attempt. */
  uploadedImageUrl: string | null;
  /** True once the "กลุ่มเป้าหมาย" save step has succeeded at least once — see handleSubmit. */
  audienceSaved: boolean;
};

const CreateCoupon = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Resolved once per render from a NON-destructive peek (never deletes) — every useState
  // initialiser below reads from this SAME value, so they restore consistently even though
  // React only actually invokes those initialiser functions once, on this component instance's
  // real first render. A destructive read here would break under React StrictMode's dev
  // double-invoke of the whole render function (the second invocation would find the key
  // already gone). The actual sessionStorage delete + marker-clearing nav happens once, from
  // an effect below — see discardCouponFormDraft.
  //
  // This has to happen HERE (lazy initialisers), not in a post-mount effect, so every field is
  // already correct on the very first render: a post-mount restore left a window where the
  // form was still `emptyCouponCoreForm()` when CouponCoreForm's children (the RichTextEditor
  // fields) ran their own mount effects — one of those could fire an onChange against that
  // still-empty state before the restore effect got a chance to run, and (via CouponCoreForm's
  // `patch`, fixed alongside this to use a functional update — see CouponCoreForm.tsx) write
  // the empty form back over the just-restored one.
  const restoredDraft = shouldRestoreDraft(searchParams)
    ? peekCouponFormDraft<CouponCreateDraft>(ADMIN_ROUTES.couponCreate)
    : null;

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [audience, setAudience] = useState(
    () => restoredDraft?.audience ?? EMPTY_COUPON_AUDIENCE_FORM,
  );
  const [redemption, setRedemption] = useState<CouponRedemptionForm>(
    () => restoredDraft?.redemption ?? EMPTY_COUPON_REDEMPTION_FORM,
  );
  // Data-URL copy of pendingImageFile, captured async at selection time (see
  // handlePendingImageFileChange) — stashDraft itself runs synchronously from a link's onClick
  // and can't read the file then, so it has to already be in state by that point.
  const [pendingImage, setPendingImage] = useState<CouponPendingImage | null>(
    () => restoredDraft?.pendingImage ?? null,
  );
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(() => {
    if (!restoredDraft?.pendingImage) return null;
    try {
      const { name, type, dataUrl } = restoredDraft.pendingImage;
      return dataUrlToFile(dataUrl, name, type);
    } catch {
      return null;
    }
  });
  // Set once an image upload step succeeds — shown as the preview afterwards, since
  // pendingImageFile is cleared at that point (see handleSubmit) so a later retry's image step
  // doesn't repeat.
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(
    () => restoredDraft?.uploadedImageUrl ?? null,
  );
  const [form, setForm] = useState(() => restoredDraft?.form ?? emptyCouponCoreForm());
  const [kind, setKind] = useState<CouponKind>(() => restoredDraft?.kind ?? 'normal');
  const [chainSourceId, setChainSourceId] = useState(() => restoredDraft?.chainSourceId ?? '');
  const [rewardForm, setRewardForm] = useState<CouponRewardForm>(
    () => restoredDraft?.rewardForm ?? EMPTY_COUPON_REWARD_FORM,
  );
  const [couponOptions, setCouponOptions] = useState<CouponOption[]>([]);
  const chainSourceSelectId = React.useId();
  // Set once the core coupon row is created (first submit attempt) — a later retry after a
  // follow-up-step failure PATCHes this same id instead of POSTing a new coupon (which would
  // 409 on the now-taken coupon_code). Restored too, so a detour after a partial create doesn't
  // re-POST on return.
  const [createdCouponId, setCreatedCouponId] = useState<string | null>(
    () => restoredDraft?.createdCouponId ?? null,
  );
  // Set once the "กลุ่มเป้าหมาย" save step succeeds — entitlements may already have gone out by
  // then, so the audience section locks (see CouponAudienceSection below) rather than letting a
  // retry silently re-target a different audience.
  const [audienceSaved, setAudienceSaved] = useState<boolean>(
    () => restoredDraft?.audienceSaved ?? false,
  );

  // "Duplicate coupon" (CouponList → ?duplicateFrom=<id>&code=<NEW>): captured once so stripping
  // the params below doesn't flip the page back to "add" mode. A restored draft wins over it.
  const [duplicateParams] = useState(() => {
    const id = searchParams.get('duplicateFrom');
    if (restoredDraft || !id) return null;
    return { id, code: (searchParams.get('code') ?? '').trim().toUpperCase() };
  });
  const [loadingSource, setLoadingSource] = useState(duplicateParams !== null);
  const [duplicatedFromCode, setDuplicatedFromCode] = useState<string | null>(null);

  // Loads the source coupon and prefills every section. CouponCoreForm is not rendered until this
  // settles (see loadingSource below) so its rich-text editors mount with the final values. The
  // `cancelled` flag drops the first run's result under StrictMode's dev double-invoke.
  useEffect(() => {
    if (!duplicateParams) return;
    let cancelled = false;
    void (async () => {
      try {
        const coupon = (await getCouponById(duplicateParams.id)).data?.data;
        if (!coupon) throw new Error('ไม่พบคูปองต้นฉบับ');
        let rulesFailed = false;
        const rules: Record<string, unknown> = await getCouponRedemptionRules(duplicateParams.id)
          .then((res) => res.data?.data ?? {})
          .catch(() => {
            rulesFailed = true;
            return {};
          });
        if (cancelled) return;
        setForm({
          ...formFromCoupon(coupon, rules),
          coupon_code: duplicateParams.code,
          // Source is usually expired — start from the default range; the admin edits it here.
          ...defaultCouponDateRange(),
          is_active: true,
        });
        setRedemption({
          ...redemptionFormFromRules(rules, Number(coupon.minimum_order_amount ?? 0)),
          refreshProductSetIds: [],
        });
        // Manual recipients are not copied; a segment id carries over (regenerated on save).
        setAudience(audienceFormFromCoupon(coupon));
        // Image is deliberately not copied — the admin uploads a fresh one for the new coupon.
        setDuplicatedFromCode(coupon.coupon_code ?? '');
        if (rulesFailed) {
          setFormError(__uiMessage("โหลดเงื่อนไขใช้โค้ดของคูปองต้นฉบับไม่สำเร็จ — ตรวจเงื่อนไขก่อนบันทึก"));
        }
      } catch (error: unknown) {
        if (cancelled) return;
        setFormError(extractApiError(error, 'โหลดคูปองต้นฉบับไม่สำเร็จ'));
      }
      if (cancelled) return;
      // A refresh must not re-copy over the admin's edits.
      navigate(ADMIN_ROUTES.couponCreate, { replace: true });
      setLoadingSource(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clears the `restoreDraft` marker (replace nav, so a refresh afterwards doesn't re-trigger
  // this) and deletes the now-consumed draft key — both idempotent, so StrictMode's dev
  // double-invoke of this effect is harmless. The actual restore already happened above,
  // synchronously, before the first paint.
  useEffect(() => {
    if (!shouldRestoreDraft(searchParams)) return;
    navigate(ADMIN_ROUTES.couponCreate, { replace: true });
    discardCouponFormDraft(ADMIN_ROUTES.couponCreate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stashed explicitly by the three out-links (via CouponDraftStashContext below) on their own
  // onClick — never from a global listener, so only those links can stash. A pending image's
  // data URL can be big enough to blow sessionStorage's quota — falls back to stashing without
  // it (see stashCouponFormDraft) rather than losing the whole draft over that one field.
  const stashDraft = () => {
    const draft: CouponCreateDraft = {
      form,
      audience,
      redemption,
      kind,
      chainSourceId,
      rewardForm,
      createdCouponId,
      pendingImage,
      uploadedImageUrl,
      audienceSaved,
    };
    stashCouponFormDraft(ADMIN_ROUTES.couponCreate, draft, { ...draft, pendingImage: null });
  };

  // Always mirrors pendingImageFile (every path that changes it, including the "upload
  // succeeded" clear in handleSubmit below) — read from inside the async FileReader callback
  // below, where a React state closure would be stale.
  const pendingImageFileRef = React.useRef<File | null>(pendingImageFile);
  useEffect(() => {
    pendingImageFileRef.current = pendingImageFile;
  }, [pendingImageFile]);

  // Wraps setPendingImageFile so a data-URL copy is captured in state at selection time (async,
  // FileReader) — stashDraft above runs synchronously from a link's onClick and can't read the
  // file then, so this has to already be done before the admin ever clicks an out-link.
  const handlePendingImageFileChange = (file: File | null) => {
    setPendingImageFile(file);
    if (!file) {
      // Synchronous — no read in flight for "no file" to race against.
      setPendingImage(null);
      return;
    }
    void fileToDataUrl(file)
      .then((dataUrl) => {
        // Picking file A then quickly B (or clearing) starts two overlapping reads — if A's
        // resolves after B became current, applying it would resurrect A's data URL over B's
        // (or over "cleared"). Only apply a read whose file is still the current pending one.
        if (pendingImageFileRef.current !== file) return;
        setPendingImage({ name: file.name, type: file.type, dataUrl });
      })
      .catch(() => {
        if (pendingImageFileRef.current !== file) return;
        setPendingImage(null);
      });
  };

  // Coupon options are only needed once the admin actually picks "chain" — load lazily on
  // first switch instead of every visit to Create.
  useEffect(() => {
    if (kind !== 'chain' || couponOptions.length > 0) return;
    void (async () => {
      try {
        setCouponOptions(await loadCouponOptions());
      } catch (error: unknown) {
        setFormError(extractApiError(error, 'โหลดรายการคูปองไม่สำเร็จ'));
      }
    })();
  }, [kind, couponOptions.length]);

  const effectiveAudienceMode = kind === 'chain' ? 'manual' : audience.mode;
  const { isNewSignupCoupon, effectiveDistributionType } = resolveCouponFormFlags(
    effectiveAudienceMode,
  );

  const handleAudienceChange = (next: CouponAudienceForm) =>
    applyCouponAudienceChange(next, setAudience, setForm);

  const chainSource = couponOptions.find((option) => option.id === chainSourceId) ?? null;
  const lockedAudienceNote =
    kind === 'chain' ? (
      <ChainLockedAudienceNote
        sourceLabel={
          chainSource ? `${chainSource.coupon_code} — ${chainSource.title}` : '(ยังไม่ได้เลือก)'
        }
      />
    ) : undefined;

  const handleSubmit = async () => {
    setFormError('');

    const coreValidation = validateCouponCoreForm(form);
    if (coreValidation.formError) {
      setFormError(coreValidation.formError);
      return false;
    }

    if (kind === 'chain') {
      if (!chainSourceId) {
        setFormError(__uiMessage("กรุณาเลือกคูปองที่ต้องใช้ก่อน"));
        return false;
      }
      const rewardFormError = validateCouponRewardForm(rewardForm);
      if (rewardFormError) {
        setFormError(rewardFormError);
        return false;
      }
    } else {
      const audienceError = validateCouponAudienceForm(audience);
      if (audienceError) {
        setFormError(audienceError);
        return false;
      }
    }

    const redemptionError = validateCouponRedemptionForm(redemption, form.discount_scope);
    if (redemptionError) {
      setFormError(redemptionError);
      return false;
    }

    setSaving(true);
    try {
      const minCartAmount = Number(redemption.minCartAmount) || 0;
      const corePayload = {
        ...couponCoreFormToPayload(form, { effectiveDistributionType, isNewSignupCoupon }),
        minimum_order_amount: minCartAmount,
        // Chain coupons (B) hide the "สร้างรหัสเฉพาะต่อคน" toggle (audience is locked) —
        // force shared codes so a stale unique_suffix value from switching kind never leaks out.
        ...(kind === 'chain' ? { code_generation: 'shared' as const } : {}),
      };

      let couponId: string | null | undefined = createdCouponId;
      if (!couponId) {
        // First attempt for this coupon — always create inactive; image/redemption
        // rules/audience below are follow-up steps that run after the row already exists, so a
        // failure partway through must never leave a live coupon with only its core fields. The
        // "เปิดใช้งาน" step at the end flips this to the form's real value only once every step
        // (this attempt's and any earlier retry's) has succeeded.
        const response = await createCoupon({ ...corePayload, is_active: false });
        couponId = response.data?.data?.id as string | undefined;

        if (!couponId) {
          setFormError(__uiMessage("สร้างคูปองไม่สำเร็จ — ไม่พบรหัสคูปองจากระบบ"));
          return false;
        }
        setCreatedCouponId(couponId);

        // Chain coupons (B) are unreachable until this rule links them to source A — do this
        // immediately, before image/redemption/audience, so a failure here can't be masked by
        // those steps succeeding and leaving B silently orphaned (never grantable to anyone).
        // Unlike the follow-up steps below, this one isn't retried in place — the source coupon
        // picker/reward fields are still fully visible on the page, but the guidance below asks
        // the admin to abandon this coupon row rather than fix-and-resubmit it, since a
        // half-linked chain reward is unlike the others (nothing to "finish", just relink).
        if (kind === 'chain') {
          try {
            await createCouponRewardRule(
              chainSourceId,
              couponRewardFormToPayload(rewardForm, couponId),
            );
          } catch (rewardRuleError: unknown) {
            navigate(ADMIN_ROUTES.couponDetail(couponId), {
              state: {
                importSummary: `สร้างคูปองแล้ว แต่เชื่อมกับคูปองต้นทางไม่สำเร็จ: ${extractApiError(rewardRuleError)} — คูปองนี้ยังไม่สามารถมอบให้ใครได้ ปิดใช้งาน/ลบคูปองนี้แล้วสร้างใหม่อีกครั้ง`,
              },
            });
            return false;
          }
        }
      } else {
        // Retrying against the coupon created on an earlier attempt — PATCH the core fields
        // (picks up anything the admin edited while fixing the earlier failure) instead of
        // POSTing a new coupon, which would 409 on the coupon_code this row already took. Stays
        // inactive; only the "เปิดใช้งาน" step below is allowed to flip it live.
        await updateCoupon(couponId, { ...corePayload, is_active: false });
      }

      // Coupon row already exists past this point (inactive). Every step below is an idempotent
      // PATCH/PUT built fresh from the CURRENT form state on every attempt — so if one fails, the
      // admin can edit ANY of these sections (not just the one that failed) and clicking Save
      // again re-sends everything with the new values, instead of silently keeping whatever an
      // earlier, already-succeeded attempt had sent. The two steps that are NOT naturally
      // idempotent (importing pasted/uploaded recipients, uploading the image) each clear their
      // own input on success, so a later retry simply has nothing left to resend for them — see
      // the "รูปภาพ" and "กลุ่มเป้าหมาย" steps below. Nothing here navigates away on failure: the
      // form stays exactly as the admin left it, and `couponId` above remembers which coupon to
      // PATCH on the next attempt (never a fresh POST, so no duplicate-coupon-code risk). The
      // coupon only ever goes live once every step below has succeeded, possibly across several
      // attempts.
      const audienceToSave: CouponAudienceForm =
        // Chain coupons (B) are never directly assignable — nobody can use B until the
        // reward rule above grants it, so audience is always manual with no recipients.
        kind === 'chain' ? { ...EMPTY_COUPON_AUDIENCE_FORM, mode: 'manual' } : audience;
      let recipientImportSummary: string | null = null;
      const allSteps: SaveStep[] = [];

      if (pendingImageFile) {
        const imageFile = pendingImageFile;
        allSteps.push({
          label: 'รูปภาพ',
          run: async () => {
            const response = await uploadCouponImage(couponId!, imageFile);
            // Clear the pending file so a later retry's step list doesn't include "รูปภาพ" again
            // (this step is only added `if (pendingImageFile)` above) — re-uploading the same
            // file isn't harmful, but there's nothing left to upload once it already succeeded.
            // Keep showing it as uploaded instead of reverting to "no image".
            setUploadedImageUrl(response.data?.data?.image_url ?? null);
            setPendingImageFile(null);
            setPendingImage(null);
          },
        });
      }

      allSteps.push({
        label: 'เงื่อนไขใช้โค้ด',
        run: () =>
          upsertCouponRedemptionRules(
            couponId!,
            redemptionFormToRules(redemption, form.discount_scope),
          ),
      });

      allSteps.push({
        label: 'กลุ่มเป้าหมาย',
        run: async () => {
          const result = await saveCouponAudience(couponId!, audienceToSave, {
            autoGenerateEntitlements: audienceToSave.mode === 'segment',
          });
          recipientImportSummary = result.importSummary;
          // Entitlements may already be out — lock the audience section from here on (see
          // CouponAudienceSection below); a retry still re-sends this step (idempotent PATCH,
          // recipients already cleared below), it just can't be edited from this page anymore.
          setAudienceSaved(true);
          // Recipients already got imported — clear the pasted text/file (mirrors CouponDetail's
          // own post-save clear) so a later retry's audience step re-sends the distribution-type
          // PATCH (idempotent, and picks up e.g. a changed audience mode) without re-importing
          // the same rows. Chain coupons never have recipients here, so nothing to clear.
          if (kind !== 'chain') {
            setAudience((current) => ({ ...current, recipientText: '', recipientFile: null }));
          }
        },
      });

      if (form.is_active) {
        allSteps.push({
          label: 'เปิดใช้งาน',
          run: () => updateCoupon(couponId!, { is_active: true }),
        });
      }

      const result = await runSaveSteps(allSteps);

      if (result.failed) {
        const doneText =
          result.completed.length > 0 ? `บันทึกไปแล้วรอบนี้: ${result.completed.join(', ')}. ` : '';
        setFormError(
          `สร้างคูปองแล้ว (คูปองยังปิดใช้งานอยู่จนกว่าจะบันทึกครบทุกขั้น) — ${doneText}` +
            `บันทึก${result.failed.label}ไม่สำเร็จ: ${extractApiError(result.failed.error)}. ` +
            `แก้ไขส่วนไหนของหน้านี้ก็ได้แล้วกดบันทึกอีกครั้ง — จะส่งค่าปัจจุบันของทุกขั้นซ้ำทั้งหมด ไม่ใช่แค่ขั้นที่พัง`,
        );
        return false; // Stay on this page — see the comment above the step list.
      }

      navigate(ADMIN_ROUTES.couponDetail(couponId), { state: { importSummary: recipientImportSummary } });
      return true;
    } catch (error: unknown) {
      setFormError(extractApiError(error));
      return false;
    } finally {
      setSaving(false);
    }
    return false;
  };

  // True once the coupon row exists (first submit attempt succeeded) — everything that a retry
  // must not be able to silently change from here on: kind/chain-source/reward-rule terms (a
  // retry PATCHes corePayload but never re-touches the reward rule, so switching kind after
  // create would desync the two) and the coupon code / code-generation mode (backend 409s on
  // that change once entitlements could exist, so lock it in the UI to match).
  const createLocked = !!createdCouponId;

  return (
    <CouponDraftStashContext.Provider value={stashDraft}>
      <AdminInsertLayout
        title={duplicateParams ? __uiText("คัดลอกคูปอง") : __uiText("สร้างคูปอง")}
        saveLabel="บันทึกคูปอง"
        steps={['ตั้งชื่อและโค้ด', 'เลือกส่วนลดและกลุ่มลูกค้า', 'บันทึกคูปอง']}
        subtitle={
          duplicatedFromCode
            ? __uiText("คัดลอกจาก {0} — ตรวจวันที่เริ่ม/สิ้นสุดก่อนบันทึก", {"0": duplicatedFromCode})
            : __uiText("สร้างคูปองพร้อมกลุ่มเป้าหมายและเงื่อนไขใช้โค้ดในครั้งเดียว")
        }
        backPath={ADMIN_ROUTES.coupons}
        saving={saving || loadingSource}
        wide
        headerActions={
          <CouponActiveSwitch
            checked={form.is_active}
            disabled={saving}
            onChange={(is_active) => setForm((current) => ({ ...current, is_active }))}
          />
        }
        onSave={handleSubmit}
      >
        <CouponFormErrorBanner error={formError} />

        {createdCouponId && formError && (
          <p className="-mt-2 mb-4 text-sm">
            <Link
              to={ADMIN_ROUTES.couponDetail(createdCouponId)}
              className="text-blue-600 hover:underline"
            >
              {__uiText("เปิดหน้ารายละเอียดคูปองนี้ (ยังปิดใช้งานอยู่)")}</Link>
          </p>
        )}

        <Section title={__uiText("รูปแบบคูปอง")}>
          <Select
            label={__uiText("รูปแบบคูปอง")}
            className="w-full"
            value={kind}
            disabled={saving || createLocked}
            onChange={(event) => setKind(event.target.value as CouponKind)}
          >
            <option value="normal">{__uiText("คูปองปกติ")}</option>
            <option value="chain">
              {__uiText("คูปองต่อเนื่อง (Chain) — มอบให้อัตโนมัติหลังลูกค้าใช้คูปองอื่นสำเร็จ")}</option>
          </Select>

          {createLocked && (
            <p className="text-xs text-gray-500">
              {__uiText("สร้างคูปองแล้ว — แก้รูปแบบ/เงื่อนไข chain ที่หน้ารายละเอียดคูปอง")}</p>
          )}

          {kind === 'chain' && (
            <div className="space-y-4">
              <div>
                <FieldLabel required htmlFor={chainSourceSelectId}>{__uiText("คูปองที่ต้องใช้ก่อน")}</FieldLabel>
                <Select
                  id={chainSourceSelectId}
                  className="w-full"
                  value={chainSourceId}
                  disabled={saving || createLocked}
                  onChange={(event) => setChainSourceId(event.target.value)}
                >
                  <option value="">{__uiText("— เลือกคูปอง —")}</option>
                  {couponOptions.map((coupon) => (
                    <option key={coupon.id} value={coupon.id}>
                      {coupon.coupon_code} — {coupon.title}
                    </option>
                  ))}
                </Select>
              </div>

              <CouponRewardRuleFields
                value={rewardForm}
                onChange={setRewardForm}
                disabled={saving || createLocked}
              />

              <p className="text-xs text-gray-500">
                {__uiText("ส่วนลดของคูปองนี้กำหนดในส่วน “ประเภทและส่วนลด” ด้านล่าง เหมือนคูปองทั่วไป ส่วนด้านบนกำหนดแค่เงื่อนไขการได้รับคูปองอัตโนมัติ")}</p>
            </div>
          )}
        </Section>

        {loadingSource ? (
          <p className="text-sm text-gray-500">{__uiText("กำลังโหลดคูปองต้นฉบับ…")}</p>
        ) : (
        <CouponCoreForm
          form={form}
          onChange={setForm}
          disabled={saving}
          formError={formError}
          pendingImageFile={pendingImageFile}
          onPendingImageFileChange={handlePendingImageFileChange}
          imageUrl={uploadedImageUrl}
          codeLocked={createLocked}
          codeLockedHint="สร้างคูปองแล้ว — เปลี่ยนรหัสไม่ได้"
          audienceIsPublic={effectiveDistributionType === 'public'}
          audienceSection={
            <CouponAudienceSection
              audience={audience}
              onAudienceChange={handleAudienceChange}
              disabled={saving || audienceSaved}
              codeGeneration={form.code_generation}
              onCodeGenerationChange={(code_generation) =>
                setForm((current) => ({ ...current, code_generation }))
              }
              lockedNote={lockedAudienceNote}
              codeGenerationLocked={createLocked}
            >
              {audienceSaved && (
                <p className="text-xs text-gray-500">
                  {__uiText("บันทึกกลุ่มเป้าหมายแล้ว — แก้ต่อที่หน้ารายละเอียดคูปอง")}</p>
              )}
            </CouponAudienceSection>
          }
          redemptionSection={
            <CouponRedemptionSection
              value={redemption}
              onChange={setRedemption}
              discountScope={form.discount_scope}
              onDiscountScopeChange={(discount_scope) =>
                setForm((current) => ({ ...current, discount_scope }))
              }
              disabled={saving}
            />
          }
        />
        )}
      </AdminInsertLayout>
    </CouponDraftStashContext.Provider>
  );
};

export default CreateCoupon;

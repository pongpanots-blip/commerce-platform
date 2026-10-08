// ui-metadata-migration: static labels and UI notices only
// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import { useEffect, useId, useRef, useState } from 'react';
import {
  getWelcomeLeadEmailAssets,
  updateWelcomeLeadEmailAssets,
  uploadWelcomeLeadImage,
  resetWelcomeLeadImage,
  translateWelcomeLeadEmail,
  previewWelcomeLeadEmail,
  type WelcomeLeadEmailAssets,
  type WelcomeLeadEmailCopy,
  type WelcomeLeadEmailStyle,
  type WelcomeLeadImageKind,
} from '@josh/shared-api';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { RichTextEditor } from '../../components/rich-text/RichTextEditor';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
import { PageHeader } from '@cp/ui';
const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none';

const SAVE_BUTTON_CLASS =
  'rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50';

const TRANSLATE_BUTTON_CLASS =
  'rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50';

const SMALL_TRANSLATE_BUTTON_CLASS =
  'rounded border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50';

const EMPTY_ASSETS: WelcomeLeadEmailAssets = {};

type Locale = 'th' | 'en';
type CopyDraft = { th: WelcomeLeadEmailCopy; en: WelcomeLeadEmailCopy };
type StyleDraft = { th: WelcomeLeadEmailStyle; en: WelcomeLeadEmailStyle };

type CopyFieldType = 'text' | 'richLimited' | 'richFull' | 'url';

/** Row order + Thai label for every copy field, mirroring the mock (`E-Mail Template_with_logo`). */
const COPY_FIELDS: { key: keyof WelcomeLeadEmailCopy; label: string; type: CopyFieldType }[] = [
  { key: 'subject', get label(){return __uiText("หัวเรื่องอีเมล (subject)");}, type: 'text' },
  { key: 'taglineTop', get label(){return __uiText("ข้อความข้างโลโก้ บรรทัด 1 (taglineTop)");}, type: 'text' },
  { key: 'taglineBottom', get label(){return __uiText("ข้อความข้างโลโก้ บรรทัด 2 – ตัวหนา (taglineBottom)");}, type: 'text' },
  { key: 'headlineTop', get label(){return __uiText("หัวข้อ บรรทัด 1 (headlineTop)");}, type: 'text' },
  { key: 'headlineBottom', get label(){return __uiText("หัวข้อ บรรทัด 2 – ตัวหนา (headlineBottom)");}, type: 'text' },
  { key: 'body', get label(){return __uiText("เนื้อหา (body)");}, type: 'richFull' },
  { key: 'cta', get label(){return __uiText("ปุ่ม (cta)");}, type: 'text' },
  { key: 'footerLegal', get label(){return __uiText("ข้อความลิขสิทธิ์ (footerLegal)");}, type: 'richLimited' },
  { key: 'terms', get label(){return __uiText("ข้อความ — Terms (terms)");}, type: 'text' },
  { key: 'termsUrl', get label(){return __uiText("URL — Terms (termsUrl)");}, type: 'url' },
  { key: 'privacy', get label(){return __uiText("ข้อความ — Privacy (privacy)");}, type: 'text' },
  { key: 'privacyUrl', get label(){return __uiText("URL — Privacy (privacyUrl)");}, type: 'url' },
];

/** Fields that get translated (text + rich); URLs are never translated. */
const TRANSLATABLE_COPY_FIELDS = COPY_FIELDS.filter((field) => field.type !== 'url');

const STYLE_FIELDS: { key: keyof WelcomeLeadEmailStyle; label: string }[] = [
  { key: 'taglineSize', get label(){return __uiText("ข้อความข้างโลโก้ (taglineSize)");} },
  { key: 'headlineSize', get label(){return __uiText("หัวข้อ (headlineSize)");} },
  { key: 'bodySize', get label(){return __uiText("เนื้อหา (bodySize)");} },
  { key: 'ctaSize', get label(){return __uiText("ปุ่ม (ctaSize)");} },
  { key: 'footerSize', get label(){return __uiText("Footer (footerSize)");} },
];

/** One copy row: label left, TH input | EN input, per-box translate buttons. Text inputs for plain/url, RichTextEditor for rich fields. */
function CopyRow({
  label,
  type,
  th,
  en,
  onChangeTh,
  onChangeEn,
  translatingKey,
  onTranslateBox,
  disabled,
}: {
  label: string;
  type: CopyFieldType;
  th: string;
  en: string;
  onChangeTh: (value: string) => void;
  onChangeEn: (value: string) => void;
  translatingKey: 'th' | 'en' | null;
  onTranslateBox: ((direction: 'th' | 'en') => void) | null;
  disabled: boolean;
}) {
  __useUiLocale();
  const thId = useId();
  const enId = useId();
  const isRich = type === 'richLimited' || type === 'richFull';
  const inputType = type === 'url' ? 'url' : 'text';

  return (
    <div className="grid gap-3 rounded-lg border border-gray-100 p-3 xl:grid-cols-[220px,minmax(0,1fr),minmax(0,1fr)]">
      <label htmlFor={isRich ? undefined : thId} className="text-xs font-medium text-gray-500">
        {label}
      </label>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">{__uiText("ไทย")}</span>
          {onTranslateBox ? (
            <button
              type="button"
              className={SMALL_TRANSLATE_BUTTON_CLASS}
              disabled={disabled}
              onClick={() => onTranslateBox('th')}
            >
              {translatingKey === 'th' ? __uiText("กำลังแปล...") : __uiText("← แปลจาก EN")}
            </button>
          ) : null}
        </div>
        {isRich ? (
          <RichTextEditor value={th} ariaLabel={`${label} (ไทย)`} onChange={onChangeTh} disabled={disabled} />
        ) : (
          <input
            id={thId}
            type={inputType}
            className={INPUT_CLASS}
            value={th}
            disabled={disabled}
            onChange={(event) => onChangeTh(event.target.value)}
          />
        )}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">{__uiText("English")}</span>
          {onTranslateBox ? (
            <button
              type="button"
              className={SMALL_TRANSLATE_BUTTON_CLASS}
              disabled={disabled}
              onClick={() => onTranslateBox('en')}
            >
              {translatingKey === 'en' ? __uiText("กำลังแปล...") : __uiText("แปลจาก ไทย →")}
            </button>
          ) : null}
        </div>
        {isRich ? (
          <RichTextEditor value={en} ariaLabel={`${label} (English)`} onChange={onChangeEn} disabled={disabled} />
        ) : (
          <input
            id={enId}
            type={inputType}
            className={INPUT_CLASS}
            value={en}
            disabled={disabled}
            onChange={(event) => onChangeEn(event.target.value)}
          />
        )}
      </div>
    </div>
  );
}

function StyleRow({
  label,
  th,
  en,
  onChangeTh,
  onChangeEn,
  disabled,
}: {
  label: string;
  th: number;
  en: number;
  onChangeTh: (value: number) => void;
  onChangeEn: (value: number) => void;
  disabled: boolean;
}) {
  __useUiLocale();
  const parse = (raw: string): number => Math.round(Number(raw)) || 0;
  return (
    <div className="grid gap-3 rounded-lg border border-gray-100 p-3 xl:grid-cols-[220px,minmax(0,1fr),minmax(0,1fr)] xl:items-center">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <input
        type="number"
        min={8}
        max={64}
        className={INPUT_CLASS}
        value={th}
        disabled={disabled}
        onChange={(event) => onChangeTh(parse(event.target.value))}
      />
      <input
        type="number"
        min={8}
        max={64}
        className={INPUT_CLASS}
        value={en}
        disabled={disabled}
        onChange={(event) => onChangeEn(parse(event.target.value))}
      />
    </div>
  );
}

const IMAGE_ASSET_CONFIG: {
  kind: WelcomeLeadImageKind;
  label: string;
  hint: string;
  checkered?: boolean;
}[] = [
  { kind: 'hero', get label() { return __uiText("Hero image"); }, get hint() { return __uiText("PNG พื้นใส แนะนำ 1200×643px"); } },
  { kind: 'logo', get label() { return __uiText("Logo"); }, get hint() { return __uiText("PNG พื้นใส แนะนำ 500×163px"); }, checkered: true },
  { kind: 'enjosh', get label() { return __uiText("Enjosh signature"); }, get hint() { return __uiText("PNG พื้นใส แนะนำ 480×277px"); }, checkered: true },
];

/** Landing order (`apps/landing-web/src/social.ts`). */
const SOCIAL_FIELDS: {
  key: keyof WelcomeLeadEmailAssets;
  resolvedKey: keyof WelcomeLeadEmailAssets;
  defaultsKey: keyof NonNullable<WelcomeLeadEmailAssets['defaults']>;
  label: string;
}[] = [
  {
    key: 'socialInstagramUrl',
    resolvedKey: 'resolvedSocialInstagramUrl',
    defaultsKey: 'socialInstagramUrl',
    get label(){return __uiText("Instagram URL");},
  },
  {
    key: 'socialTiktokUrl',
    resolvedKey: 'resolvedSocialTiktokUrl',
    defaultsKey: 'socialTiktokUrl',
    get label(){return __uiText("TikTok URL");},
  },
  {
    key: 'socialFacebookUrl',
    resolvedKey: 'resolvedSocialFacebookUrl',
    defaultsKey: 'socialFacebookUrl',
    get label(){return __uiText("Facebook URL");},
  },
  {
    key: 'socialLinkedinUrl',
    resolvedKey: 'resolvedSocialLinkedinUrl',
    defaultsKey: 'socialLinkedinUrl',
    get label(){return __uiText("LinkedIn URL");},
  },
];

const RESOLVED_URL_KEY: Record<WelcomeLeadImageKind, keyof WelcomeLeadEmailAssets> = {
  hero: 'resolvedHeroUrl',
  logo: 'resolvedLogoUrl',
  enjosh: 'resolvedEnjoshUrl',
};

const OVERRIDE_URL_KEY: Record<WelcomeLeadImageKind, keyof WelcomeLeadEmailAssets> = {
  hero: 'heroUrl',
  logo: 'logoUrl',
  enjosh: 'enjoshUrl',
};

/** One image card: preview, upload-only file input, "ใช้ค่าเริ่มต้น" reset button. */
function ImageAssetCard({
  label,
  hint,
  checkered,
  previewUrl,
  hasOverride,
  uploading,
  resetting,
  onUpload,
  onReset,
}: {
  label: string;
  hint: string;
  checkered?: boolean;
  previewUrl: string | null | undefined;
  hasOverride: boolean;
  uploading: boolean;
  resetting: boolean;
  onUpload: (file: File) => void;
  onReset: () => void;
}) {
  __useUiLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = uploading || resetting;

  return (
    <div className="space-y-3 rounded-lg border border-gray-100 p-4">
      <h3 className="text-xs font-medium text-gray-500">{label}</h3>
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={__uiText("{0} preview", {"0": label})}
          className={`max-h-40 w-full rounded-lg border border-gray-100 object-contain ${
            checkered ? 'bg-gray-100' : ''
          }`}
        />
      ) : (
        <p className="text-sm text-gray-500">{__uiText("ไม่มีรูปพรีวิว")}</p>
      )}
      <p className="text-xs text-gray-400">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className={SAVE_BUTTON_CLASS}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? __uiText("กำลังอัปโหลด…") : __uiText("อัปโหลด")}
        </button>
        <button
          type="button"
          className={TRANSLATE_BUTTON_CLASS}
          disabled={busy || !hasOverride}
          onClick={onReset}
        >
          {resetting ? __uiText("กำลังรีเซ็ต…") : __uiText("ใช้ค่าเริ่มต้น")}
        </button>
      </div>
    </div>
  );
}

/** Fallback defaults used only until GET returns real ones — every field required, so this must be complete. */
const FALLBACK_COPY: WelcomeLeadEmailCopy = {
  subject: '',
  taglineTop: '',
  taglineBottom: '',
  headlineTop: '',
  headlineBottom: '',
  body: '',
  cta: '',
  footerLegal: '',
  terms: '',
  termsUrl: '',
  privacy: '',
  privacyUrl: '',
};

const FALLBACK_STYLE: WelcomeLeadEmailStyle = {
  taglineSize: 11,
  headlineSize: 32,
  bodySize: 15,
  ctaSize: 14,
  footerSize: 11,
};

export default function WelcomeLeadEmailPage() {
  __useUiLocale();
  const [assets, setAssets] = useState<WelcomeLeadEmailAssets>(EMPTY_ASSETS);
  const [copy, setCopy] = useState<CopyDraft>({ th: FALLBACK_COPY, en: FALLBACK_COPY });
  const [style, setStyle] = useState<StyleDraft>({ th: FALLBACK_STYLE, en: FALLBACK_STYLE });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<WelcomeLeadImageKind | null>(null);
  const [resettingKind, setResettingKind] = useState<WelcomeLeadImageKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [translating, setTranslating] = useState(false);
  const [translateStatus, setTranslateStatus] = useState('');
  const [translatingBox, setTranslatingBox] = useState<{ key: keyof WelcomeLeadEmailCopy; lang: 'th' | 'en' } | null>(
    null,
  );

  const [previewLocale, setPreviewLocale] = useState<Locale>('th');
  const [previewWidth, setPreviewWidth] = useState<600 | 375>(600);
  const [previewSubject, setPreviewSubject] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const defaultsCopy = assets.defaults?.copy ?? { th: FALLBACK_COPY, en: FALLBACK_COPY };
  const defaultsStyle = assets.defaults?.style ?? { th: FALLBACK_STYLE, en: FALLBACK_STYLE };
  const defaultsAssets = assets.defaults ?? {
    socialInstagramUrl: '',
    socialTiktokUrl: '',
    socialFacebookUrl: '',
    socialLinkedinUrl: '',
  };

  useEffect(() => {
    getWelcomeLeadEmailAssets()
      .then((data) => {
        const seededSocials = Object.fromEntries(
          SOCIAL_FIELDS.map(({ key, resolvedKey }) => [key, data[key] ?? data[resolvedKey] ?? '']),
        );
        setAssets({ ...data, ...seededSocials });
        setCopy({
          th: data.copy?.th ?? data.defaults?.copy.th ?? FALLBACK_COPY,
          en: data.copy?.en ?? data.defaults?.copy.en ?? FALLBACK_COPY,
        });
        setStyle({
          th: data.style?.th ?? data.defaults?.style.th ?? FALLBACK_STYLE,
          en: data.style?.en ?? data.defaults?.style.en ?? FALLBACK_STYLE,
        });
      })
      .catch((err: Error) => setError(err.message || __uiMessage("โหลดไม่สำเร็จ")))
      .finally(() => setLoading(false));
  }, []);

  const buildPatchPayload = () => ({
    ctaUrl: assets.ctaUrl ?? null,
    socialInstagramUrl: assets.socialInstagramUrl ?? '',
    socialTiktokUrl: assets.socialTiktokUrl ?? '',
    socialFacebookUrl: assets.socialFacebookUrl ?? '',
    socialLinkedinUrl: assets.socialLinkedinUrl ?? '',
    bgColor: assets.bgColor ?? null,
    bgGradientStop: assets.bgGradientStop ?? null,
    copy,
    style,
  });

  // Debounced auto-refresh of the preview on any draft change, skipped while translating.
  useEffect(() => {
    if (loading || translating) return;
    const timer = setTimeout(() => void refreshPreview(), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, copy, style, previewLocale, loading, translating]);

  const refreshPreview = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const result = await previewWelcomeLeadEmail({ locale: previewLocale, ...buildPatchPayload() });
      setPreviewSubject(result.subject);
      setPreviewHtml(result.html);
    } catch (err: any) {
      setPreviewError(err?.response?.data?.message || __uiMessage("พรีวิวไม่สำเร็จ"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await updateWelcomeLeadEmailAssets(buildPatchPayload());
      setAssets(saved);
      setCopy({
        th: saved.copy?.th ?? defaultsCopy.th,
        en: saved.copy?.en ?? defaultsCopy.en,
      });
      setStyle({
        th: saved.style?.th ?? defaultsStyle.th,
        en: saved.style?.en ?? defaultsStyle.en,
      });
      setMessage('บันทึกแล้ว — อีเมลถัดไปจะใช้ค่าใหม่');
    } catch (err: any) {
      setError(err?.response?.data?.message || (err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (kind: WelcomeLeadImageKind, file: File) => {
    setUploadingKind(kind);
    setError(null);
    setMessage(null);
    try {
      const saved = await uploadWelcomeLeadImage(kind, file);
      setAssets(saved);
      setMessage('อัปโหลดรูปแล้ว — อีเมลถัดไปจะใช้รูปใหม่');
    } catch (err: any) {
      setError(err?.response?.data?.message || (err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ'));
    } finally {
      setUploadingKind(null);
    }
  };

  const handleImageReset = async (kind: WelcomeLeadImageKind) => {
    if (!window.confirm(__uiText("ใช้ค่าเริ่มต้นสำหรับรูปนี้? รูปที่อัปโหลดไว้จะถูกลบ"))) return;
    setResettingKind(kind);
    setError(null);
    setMessage(null);
    try {
      const saved = await resetWelcomeLeadImage(kind);
      setAssets(saved);
      setMessage('รีเซ็ตเป็นค่าเริ่มต้นแล้ว');
    } catch (err: any) {
      setError(err?.response?.data?.message || (err instanceof Error ? err.message : 'รีเซ็ตไม่สำเร็จ'));
    } finally {
      setResettingKind(null);
    }
  };

  const setCopyField = (lang: 'th' | 'en', key: keyof WelcomeLeadEmailCopy, value: string) => {
    setCopy((prev) => ({ ...prev, [lang]: { ...prev[lang], [key]: value } }));
  };

  const setStyleField = (lang: 'th' | 'en', key: keyof WelcomeLeadEmailStyle, value: number) => {
    setStyle((prev) => ({ ...prev, [lang]: { ...prev[lang], [key]: value } }));
  };

  const translateBox = async (key: keyof WelcomeLeadEmailCopy, targetLang: 'th' | 'en') => {
    const sourceLang = targetLang === 'th' ? 'en' : 'th';
    const source = copy[sourceLang][key] || defaultsCopy[sourceLang][key];
    setTranslatingBox({ key, lang: targetLang });
    setTranslating(true);
    try {
      const [translated] = await translateWelcomeLeadEmail({ from: sourceLang, to: targetLang, items: [source] });
      setCopyField(targetLang, key, translated);
    } catch (err: any) {
      setTranslateStatus(err?.response?.data?.message || 'แปลไม่สำเร็จ');
    } finally {
      setTranslatingBox(null);
      setTranslating(false);
    }
  };

  const translateAll = async (from: 'th' | 'en', to: 'th' | 'en') => {
    const targetName = to === 'en' ? 'อังกฤษ' : 'ไทย';
    if (!window.confirm(__uiText("การแปลจะเขียนทับข้อความภาษา{0}ทั้งหมด ยืนยัน?", {"0": targetName}))) return;
    const sourceCopy = copy[from];
    const sourceDefaults = defaultsCopy[from];
    const items = TRANSLATABLE_COPY_FIELDS.map(({ key }) => sourceCopy[key] || sourceDefaults[key]);
    setTranslating(true);
    setTranslateStatus('กำลังแปล…');
    try {
      const translatedItems = await translateWelcomeLeadEmail({ from, to, items });
      setCopy((prev) => {
        const next = { ...prev[to] };
        TRANSLATABLE_COPY_FIELDS.forEach(({ key }, index) => {
          next[key] = translatedItems[index];
        });
        return { ...prev, [to]: next };
      });
      setTranslateStatus('แปลสำเร็จ');
    } catch (err: any) {
      setTranslateStatus(err?.response?.data?.message || 'แปลไม่สำเร็จ');
    } finally {
      setTranslating(false);
    }
  };

  const resetCopy = () => {
    if (!window.confirm(__uiText("รีเซ็ตข้อความอีเมลทั้งสองภาษาเป็นค่าเริ่มต้น?"))) return;
    setCopy({ th: defaultsCopy.th, en: defaultsCopy.en });
  };

  const resetStyle = () => {
    if (!window.confirm(__uiText("รีเซ็ตขนาดตัวอักษรทั้งสองภาษาเป็นค่าเริ่มต้น?"))) return;
    setStyle({ th: defaultsStyle.th, en: defaultsStyle.en });
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">{__uiText("กำลังโหลด…")}</div>;
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-6">
      <PageHeader
        back={{ to: ADMIN_ROUTES.marketingSettings, label: 'ตั้งค่าการตลาด' }}
        title={__uiText("Welcome Lead Email")}
        subtitle={__uiText("แก้ไขข้อความ ขนาดตัวอักษร และรูป/URL ของอีเมลต้อนรับหลัง lead intake — มีผลทันทีใน prod ไม่ต้อง redeploy")}
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{(typeof error === 'string' ? __uiText(error) : error)}</div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </div>
      ) : null}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr),660px]">
        <div className="space-y-6">
          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">{__uiText("รูปภาพ")}</h2>
              {assets.updatedAt ? (
                <span className="text-xs text-gray-400">{__uiText("อัปเดตล่าสุด: ")}{assets.updatedAt}</span>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {IMAGE_ASSET_CONFIG.map(({ kind, label, hint, checkered }) => (
                <ImageAssetCard
                  key={kind}
                  label={label}
                  hint={hint}
                  checkered={checkered}
                  previewUrl={assets[RESOLVED_URL_KEY[kind]] as string | null | undefined}
                  hasOverride={Boolean(assets[OVERRIDE_URL_KEY[kind]])}
                  uploading={uploadingKind === kind}
                  resetting={resettingKind === kind}
                  onUpload={(file) => void handleImageUpload(kind, file)}
                  onReset={() => void handleImageReset(kind)}
                />
              ))}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">{__uiText("Assets อื่นๆ")}</h2>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">{__uiText("CTA URL")}</label>
              <input
                type="url"
                className={INPUT_CLASS}
                value={assets.ctaUrl ?? ''}
                onChange={(event) => setAssets((prev) => ({ ...prev, ctaUrl: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">{__uiText("สีพื้นหลังอีเมล")}</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-12 rounded border border-gray-200"
                  value={assets.bgColor || assets.resolvedBgColor || '#F9FAEC'}
                  onChange={(event) => setAssets((prev) => ({ ...prev, bgColor: event.target.value }))}
                />
                <input
                  type="text"
                  className={INPUT_CLASS}
                  placeholder={assets.resolvedBgColor ?? '#F9FAEC'}
                  value={assets.bgColor ?? ''}
                  onChange={(event) => setAssets((prev) => ({ ...prev, bgColor: event.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                {__uiText("ไล่สีจากขาวถึง (% ของความสูง)")}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  className="w-full"
                  value={assets.bgGradientStop ?? assets.resolvedBgGradientStop ?? 50}
                  onChange={(event) =>
                    setAssets((prev) => ({ ...prev, bgGradientStop: Number(event.target.value) }))
                  }
                />
                <span className="w-10 shrink-0 text-right text-sm text-gray-600">
                  {assets.bgGradientStop ?? assets.resolvedBgGradientStop ?? 50}%
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {__uiText("0 = สีพื้นล้วน, 50 ≈ ใต้ลายเซ็น Enjosh (ตาม mock)")}</p>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">{__uiText("โซเชียล")}</h2>
            {SOCIAL_FIELDS.map(({ key, defaultsKey, label }) => (
              <div key={key}>
                <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="url"
                    className={INPUT_CLASS}
                    value={assets[key] ?? ''}
                    onChange={(event) => setAssets((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                  <button
                    type="button"
                    className={TRANSLATE_BUTTON_CLASS}
                    onClick={() =>
                      setAssets((prev) => ({ ...prev, [key]: defaultsAssets[defaultsKey] }))
                    }
                  >
                    {__uiText("ใช้ค่าเริ่มต้น")}</button>
                </div>
                <p className="mt-1 text-xs text-gray-400">{__uiText("ลบให้ว่างแล้วบันทึก = ซ่อนไอคอน")}</p>
              </div>
            ))}
          </section>

          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">{__uiText("ข้อความอีเมล")}</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={TRANSLATE_BUTTON_CLASS}
                  disabled={translating}
                  onClick={() => void translateAll('th', 'en')}
                >
                  {__uiText("แปลทั้งหมด TH → EN")}</button>
                <button
                  type="button"
                  className={TRANSLATE_BUTTON_CLASS}
                  disabled={translating}
                  onClick={() => void translateAll('en', 'th')}
                >
                  {__uiText("แปลทั้งหมด EN → TH")}</button>
                <button
                  type="button"
                  className={TRANSLATE_BUTTON_CLASS}
                  disabled={translating}
                  onClick={resetCopy}
                >
                  {__uiText("รีเซ็ตเป็นค่าเริ่มต้น")}</button>
              </div>
            </div>
            {translateStatus && <p className="text-xs text-gray-500">{translateStatus}</p>}
            <div className="space-y-2">
              {COPY_FIELDS.map(({ key, label, type }) => (
                <CopyRow
                  key={key}
                  label={label}
                  type={type}
                  th={copy.th[key] ?? ''}
                  en={copy.en[key] ?? ''}
                  onChangeTh={(value) => setCopyField('th', key, value)}
                  onChangeEn={(value) => setCopyField('en', key, value)}
                  translatingKey={translatingBox?.key === key ? translatingBox.lang : null}
                  onTranslateBox={type === 'url' ? null : (lang) => void translateBox(key, lang)}
                  disabled={translating}
                />
              ))}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">{__uiText("ขนาดตัวอักษร (px)")}</h2>
              <button type="button" className={TRANSLATE_BUTTON_CLASS} disabled={translating} onClick={resetStyle}>
                {__uiText("รีเซ็ตเป็นค่าเริ่มต้น")}</button>
            </div>
            <div className="space-y-2">
              {STYLE_FIELDS.map(({ key, label }) => (
                <StyleRow
                  key={key}
                  label={label}
                  th={style.th[key]}
                  en={style.en[key]}
                  onChangeTh={(value) => setStyleField('th', key, value)}
                  onChangeEn={(value) => setStyleField('en', key, value)}
                  disabled={translating}
                />
              ))}
            </div>
          </section>

          <button type="button" className={SAVE_BUTTON_CLASS} disabled={saving || translating} onClick={() => void handleSave()}>
            {saving ? __uiText("กำลังบันทึก…") : __uiText("บันทึก")}
          </button>
        </div>

        <div className="min-w-0 2xl:sticky 2xl:top-6 2xl:self-start">
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">{__uiText("Preview")}</h2>
              <div className="flex gap-2">
                {(['th', 'en'] as const).map((locale) => (
                  <button
                    key={locale}
                    type="button"
                    className={`px-2 py-1 text-xs font-medium ${
                      previewLocale === locale ? 'border-b-2 border-primary text-primary' : 'text-gray-400 hover:text-gray-600'
                    }`}
                    onClick={() => setPreviewLocale(locale)}
                  >
                    {locale === 'th' ? __uiText("ไทย") : __uiText("English")}
                  </button>
                ))}
                <span className="mx-1 border-l border-gray-200" />
                {([600, 375] as const).map((width) => (
                  <button
                    key={width}
                    type="button"
                    className={`px-2 py-1 text-xs font-medium ${
                      previewWidth === width ? 'border-b-2 border-primary text-primary' : 'text-gray-400 hover:text-gray-600'
                    }`}
                    onClick={() => setPreviewWidth(width)}
                  >
                    {width === 600 ? __uiText("Desktop") : __uiText("Mobile")}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className={TRANSLATE_BUTTON_CLASS}
              disabled={previewLoading || translating}
              onClick={() => void refreshPreview()}
            >
              {previewLoading ? __uiText("กำลังโหลด preview…") : __uiText("รีเฟรช preview")}
            </button>
            {previewError && <p className="text-xs text-red-500">{(typeof (previewError) === 'string' ? __uiText(previewError) : previewError)}</p>}
            <p className="text-xs font-medium text-gray-700">{__uiText("หัวเรื่อง: ")}{previewSubject || '—'}</p>
            <div style={{ overflowX: 'auto' }}>
              <iframe
                title={__uiText("welcome-lead-email-preview")}
                sandbox=""
                srcDoc={previewHtml}
                style={{ width: previewWidth, height: 'calc(100vh - 230px)', minHeight: 700 }}
                className="rounded-lg border border-gray-200"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

// ui-metadata-migration: static labels and UI notices only
import { useId } from 'react';
import { Select } from '@josh/shared-ui-web';
import type { EmailChrome, PopupChrome } from './creative-editor.types';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-primary focus:outline-none';
const LABEL_CLASS = 'mb-1 block text-[10px] font-medium text-gray-500';

const CORNER_OPTIONS: Array<{ value: NonNullable<PopupChrome['closeButton']>['corner']; label: string }> = [
  { value: 'tr', get label(){return __uiText("บนขวา");} },
  { value: 'tl', get label(){return __uiText("บนซ้าย");} },
  { value: 'br', get label(){return __uiText("ล่างขวา");} },
  { value: 'bl', get label(){return __uiText("ล่างซ้าย");} },
];

/** Right-panel inspector for popup-level chrome — panel bg/width/radius, close corner, display delay. */
export function ChromeInspector({
  meta,
  onChange,
  translating,
  chromeOverlay,
  onPatchChromeOverlay,
}: {
  meta: PopupChrome;
  onChange: (patch: Partial<PopupChrome>) => void;
  /** True when the editor is in a non-Thai locale — dismiss label + background image
   * route through `chromeOverlay`/`onPatchChromeOverlay` instead of the base `meta`. */
  translating?: boolean;
  chromeOverlay?: { dismissLabel?: string; backgroundImageUrl?: string };
  onPatchChromeOverlay?: (patch: { dismissLabel?: string; backgroundImageUrl?: string }) => void;
}) {
  __useUiLocale();
  const uid = useId();
  const isTranslating = Boolean(translating && onPatchChromeOverlay);
  // Resolver only applies chrome.dismissLabel when the base already has a dismiss
  // button (both schema copies) — writing an EN label with no base button would be
  // silently dropped and unrecoverable from EN mode. Disable the field instead.
  const dismissLabelDisabled = isTranslating && !meta.dismissButton;
  // Effective background image: overlay wins in translating mode, else base — so the
  // cover/contain/repeat style select is reachable even when only the EN overlay sets
  // an image (common when the Thai popup has none).
  const effectiveBackgroundImageUrl = isTranslating
    ? (chromeOverlay?.backgroundImageUrl ?? meta.backgroundImageUrl)
    : meta.backgroundImageUrl;
  return (
    <div className="space-y-2.5 rounded-lg border border-gray-200 bg-white p-2.5">
      <p className="text-[10px] font-semibold tracking-wide text-gray-400">{__uiText("POPUP CHROME")}</p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${uid}-width`}>
            {__uiText("ความกว้าง (px)")}</label>
          <input
            id={`${uid}-width`}
            type="number"
            min={240}
            className={INPUT_CLASS}
            value={meta.widthPx ?? 720}
            onChange={(event) => onChange({ widthPx: Number(event.target.value) || undefined })}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={`${uid}-radius`}>
            {__uiText("มุมโค้ง (px)")}</label>
          <input
            id={`${uid}-radius`}
            type="number"
            min={0}
            className={INPUT_CLASS}
            value={meta.borderRadiusPx ?? 16}
            onChange={(event) => onChange({ borderRadiusPx: Number(event.target.value) || 0 })}
          />
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS} id={`${uid}-bg-label`}>
          {__uiText("สีพื้นหลัง popup")}</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-labelledby={`${uid}-bg-label`}
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
            value={
              /^#[0-9a-f]{6}$/i.test(meta.backgroundColor ?? '')
                ? (meta.backgroundColor as string)
                : '#ffffff'
            }
            onChange={(event) => onChange({ backgroundColor: event.target.value })}
          />
          <input
            type="text"
            aria-labelledby={`${uid}-bg-label`}
            className={`${INPUT_CLASS} font-mono`}
            placeholder={__uiText("#ffffff (ค่าเริ่มต้น)")}
            value={
              meta.backgroundColor === 'transparent'
                ? ''
                : (meta.backgroundColor ?? '#ffffff')
            }
            onChange={(event) => {
              const value = event.target.value.trim();
              if (!value) {
                onChange({ backgroundColor: 'transparent' });
                return;
              }
              onChange({ backgroundColor: value });
            }}
          />
          {meta.backgroundColor && meta.backgroundColor !== 'transparent' ? (
            <button
              type="button"
              className="shrink-0 text-[10px] text-gray-400 hover:text-danger"
              onClick={() => onChange({ backgroundColor: 'transparent' })}
            >
              {__uiText("โปร่งใส")}</button>
          ) : null}
        </div>
        <p className="mt-0.5 text-[10px] text-gray-400">
          {__uiText("ค่าเริ่มต้นขาว · กดโปร่งใสถ้าไม่ต้องการพื้นหลัง · overlay ล็อกเสมอ")}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${uid}-corner`}>
            {__uiText("ปุ่มปิดมุม")}</label>
          <Select
            id={`${uid}-corner`}
            className="w-full"
            value={meta.closeButton?.corner ?? 'tr'}
            onChange={(event) =>
              onChange({
                closeButton: {
                  ...meta.closeButton,
                  corner: event.target.value as NonNullable<PopupChrome['closeButton']>['corner'],
                },
              })
            }
          >
            {CORNER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={`${uid}-delay`}>
            {__uiText("หน่วงเวลาแสดง (วินาที)")}</label>
          <input
            id={`${uid}-delay`}
            type="number"
            min={0}
            step={0.5}
            className={INPUT_CLASS}
            value={meta.displayDelaySeconds ?? 0}
            onChange={(event) => onChange({ displayDelaySeconds: Number(event.target.value) || 0 })}
          />
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS} htmlFor={`${uid}-position`}>
          {__uiText("ตำแหน่ง")}</label>
        <Select id={`${uid}-position`} className="w-full" value={meta.position ?? 'center'} onChange={(e) => onChange({ position: e.target.value as PopupChrome['position'] })}>
          <option value="center">{__uiText("Center")}</option>
          <option value="top">{__uiText("ด้านบน")}</option>
          <option value="bottom">{__uiText("Bottom")}</option>
          <option value="bottom-sheet">{__uiText("Bottom Sheet")}</option>
          <option value="side-right">{__uiText("แผงด้านขวา")}</option>
        </Select>
      </div>

      {/* Dismiss button */}
      <div>
        <p className="mb-1 text-[10px] font-medium text-gray-500">{__uiText("ปุ่ม Dismiss (ไม่บังคับ)")}</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={LABEL_CLASS} htmlFor={`${uid}-dismiss-label`}>
              {__uiText("ป้ายปุ่ม")}</label>
            <input
              id={`${uid}-dismiss-label`}
              className={INPUT_CLASS}
              disabled={dismissLabelDisabled}
              placeholder={isTranslating ? meta.dismissButton?.label || __uiText("ป้ายปุ่ม เช่น ไม่เห็นอีกในวันนี้") : __uiText("ป้ายปุ่ม เช่น ไม่เห็นอีกในวันนี้")}
              value={isTranslating ? (chromeOverlay?.dismissLabel ?? '') : (meta.dismissButton?.label ?? '')}
              onChange={(e) =>
                isTranslating
                  ? onPatchChromeOverlay?.({ dismissLabel: e.target.value })
                  : onChange({ dismissButton: e.target.value ? { label: e.target.value, capHours: meta.dismissButton?.capHours ?? 24 } : undefined })
              }
            />
          </div>
          <div className="w-20">
            <label className={LABEL_CLASS} htmlFor={`${uid}-cap-hours`}>
              {__uiText("ไม่แสดงซ้ำ (ชม.)")}</label>
            <input
              id={`${uid}-cap-hours`}
              type="number" min={1}
              className={INPUT_CLASS}
              placeholder={__uiText("ชม.")}
              value={meta.dismissButton?.capHours ?? 24}
              onChange={(e) => onChange({ dismissButton: meta.dismissButton ? { ...meta.dismissButton, capHours: Number(e.target.value) } : undefined })}
            />
          </div>
        </div>
        {dismissLabelDisabled ? (
          <p className="text-[10px] text-warn mt-0.5">
            {__uiText("กรุณาตั้งค่าปุ่ม Dismiss จากภาษาไทยก่อน จึงจะแปลป้ายปุ่มได้")}</p>
        ) : (
          <p className="text-[10px] text-gray-400 mt-0.5">{__uiText("ชั่วโมงที่ไม่แสดงหลังกดปุ่มนี้ — 8760 = ถาวร")}</p>
        )}
      </div>

      {/* Enter animation */}
      <div>
        <label className={LABEL_CLASS} htmlFor={`${uid}-anim`}>
          {__uiText("ลูกเล่นตอนแสดง (Animation)")}</label>
        <Select id={`${uid}-anim`} className="w-full" value={meta.enterAnimation ?? 'fade'} onChange={(e) => onChange({ enterAnimation: e.target.value as PopupChrome['enterAnimation'] })}>
          <option value="none">{__uiText("ไม่มี")}</option>
          <option value="fade">{__uiText("Fade")}</option>
          <option value="slide-up">{__uiText("Slide Up")}</option>
          <option value="slide-down">{__uiText("Slide Down")}</option>
          <option value="zoom">{__uiText("Zoom")}</option>
        </Select>
      </div>

      {/* Background image */}
      <div>
        <label className={LABEL_CLASS} htmlFor={`${uid}-bg-image`}>
          {__uiText("ลิงก์รูปพื้นหลัง (ไม่บังคับ)")}</label>
        <input
          id={`${uid}-bg-image`}
          className={INPUT_CLASS}
          value={isTranslating ? (chromeOverlay?.backgroundImageUrl ?? '') : (meta.backgroundImageUrl ?? '')}
          onChange={(e) =>
            isTranslating
              ? onPatchChromeOverlay?.({ backgroundImageUrl: e.target.value })
              : onChange({ backgroundImageUrl: e.target.value || undefined })
          }
          placeholder={isTranslating ? meta.backgroundImageUrl || 'https://...' : 'https://...'}
        />
        {effectiveBackgroundImageUrl && (
          <>
            <label className={LABEL_CLASS} htmlFor={`${uid}-bg-image-style`}>
              {__uiText("รูปแบบการแสดงรูปพื้นหลัง")}</label>
            <Select id={`${uid}-bg-image-style`} className="w-full mt-1" value={meta.backgroundImageStyle ?? 'cover'} onChange={(e) => onChange({ backgroundImageStyle: e.target.value as PopupChrome['backgroundImageStyle'] })}>
              <option value="cover">{__uiText("Cover")}</option>
              <option value="contain">{__uiText("Contain")}</option>
              <option value="repeat">{__uiText("Repeat")}</option>
            </Select>
          </>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-gray-400">
        {__uiText("หน่วงเวลาแสดงหลัง popup ถูก enroll เพื่อไม่ให้กระพริบทันทีที่โหลดหน้า")}</p>
    </div>
  );
}

/** Right-panel inspector for email-level chrome — content width, outer + content-card backgrounds. */
export function EmailChromeInspector({
  meta,
  onChange,
}: {
  meta: EmailChrome;
  onChange: (patch: Partial<EmailChrome>) => void;
}) {
  __useUiLocale();
  const uid = useId();
  return (
    <div className="space-y-2.5 rounded-lg border border-gray-200 bg-white p-2.5">
      <p className="text-[10px] font-semibold tracking-wide text-gray-400">{__uiText("กรอบอีเมล")}</p>

      <div>
        <label className={LABEL_CLASS} htmlFor={`${uid}-content-width`}>
          {__uiText("ความกว้างเนื้อหา (px)")}</label>
        <input
          id={`${uid}-content-width`}
          type="number"
          min={320}
          className={INPUT_CLASS}
          value={meta.contentWidthPx ?? 600}
          onChange={(event) => onChange({ contentWidthPx: Number(event.target.value) || undefined })}
        />
      </div>

      <div>
        <label className={LABEL_CLASS} id={`${uid}-outer-bg-label`}>
          {__uiText("สีพื้นหลังนอกอีเมล")}</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-labelledby={`${uid}-outer-bg-label`}
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
            value={/^#[0-9a-f]{6}$/i.test(meta.backgroundColor ?? '') ? (meta.backgroundColor as string) : '#f4f4f4'}
            onChange={(event) => onChange({ backgroundColor: event.target.value })}
          />
          <input
            type="text"
            aria-labelledby={`${uid}-outer-bg-label`}
            className={`${INPUT_CLASS} font-mono`}
            placeholder="#f4f4f4"
            value={meta.backgroundColor ?? ''}
            onChange={(event) => onChange({ backgroundColor: event.target.value || undefined })}
          />
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS} id={`${uid}-card-bg-label`}>
          {__uiText("สีพื้นหลังการ์ดเนื้อหา")}</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-labelledby={`${uid}-card-bg-label`}
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
            value={
              /^#[0-9a-f]{6}$/i.test(meta.contentBackgroundColor ?? '') ? (meta.contentBackgroundColor as string) : '#ffffff'
            }
            onChange={(event) => onChange({ contentBackgroundColor: event.target.value })}
          />
          <input
            type="text"
            aria-labelledby={`${uid}-card-bg-label`}
            className={`${INPUT_CLASS} font-mono`}
            placeholder="#ffffff"
            value={meta.contentBackgroundColor ?? ''}
            onChange={(event) => onChange({ contentBackgroundColor: event.target.value || undefined })}
          />
        </div>
      </div>
      <p className="text-[10px] leading-relaxed text-gray-400">
        {__uiText("เนื้อหาอยู่กึ่งกลางอีเมลเสมอ — ความกว้างนี้คือขนาดสูงสุดของการ์ดเนื้อหา (ไม่ใช่ทั้งอีเมล)")}</p>
    </div>
  );
}

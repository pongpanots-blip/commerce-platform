import { useId } from 'react';
import { Select } from '@josh/shared-ui-web';
import type { EmailChrome, PopupChrome } from './creative-editor.types';

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-primary focus:outline-none';
const LABEL_CLASS = 'mb-1 block text-[10px] font-medium text-gray-500';

const CORNER_OPTIONS: Array<{ value: NonNullable<PopupChrome['closeButton']>['corner']; label: string }> = [
  { value: 'tr', label: 'บนขวา' },
  { value: 'tl', label: 'บนซ้าย' },
  { value: 'br', label: 'ล่างขวา' },
  { value: 'bl', label: 'ล่างซ้าย' },
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
      <p className="text-[10px] font-semibold tracking-wide text-gray-400">POPUP CHROME</p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${uid}-width`}>
            ความกว้าง (px)
          </label>
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
            มุมโค้ง (px)
          </label>
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
          สีพื้นหลัง popup
        </label>
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
            placeholder="#ffffff (ค่าเริ่มต้น)"
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
              className="shrink-0 text-[10px] text-gray-400 hover:text-red-500"
              onClick={() => onChange({ backgroundColor: 'transparent' })}
            >
              โปร่งใส
            </button>
          ) : null}
        </div>
        <p className="mt-0.5 text-[10px] text-gray-400">
          ค่าเริ่มต้นขาว · กดโปร่งใสถ้าไม่ต้องการพื้นหลัง · overlay ล็อกเสมอ
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${uid}-corner`}>
            ปุ่มปิดมุม
          </label>
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
            หน่วงเวลาแสดง (วินาที)
          </label>
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
          ตำแหน่ง
        </label>
        <Select id={`${uid}-position`} className="w-full" value={meta.position ?? 'center'} onChange={(e) => onChange({ position: e.target.value as PopupChrome['position'] })}>
          <option value="center">Center</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="bottom-sheet">Bottom Sheet</option>
          <option value="side-right">Side Panel (ขวา)</option>
        </Select>
      </div>

      {/* Dismiss button */}
      <div>
        <p className="mb-1 text-[10px] font-medium text-gray-500">ปุ่ม Dismiss (ไม่บังคับ)</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={LABEL_CLASS} htmlFor={`${uid}-dismiss-label`}>
              ป้ายปุ่ม
            </label>
            <input
              id={`${uid}-dismiss-label`}
              className={INPUT_CLASS}
              disabled={dismissLabelDisabled}
              placeholder={isTranslating ? meta.dismissButton?.label || 'ป้ายปุ่ม เช่น ไม่เห็นอีกในวันนี้' : 'ป้ายปุ่ม เช่น ไม่เห็นอีกในวันนี้'}
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
              ไม่แสดงซ้ำ (ชม.)
            </label>
            <input
              id={`${uid}-cap-hours`}
              type="number" min={1}
              className={INPUT_CLASS}
              placeholder="ชม."
              value={meta.dismissButton?.capHours ?? 24}
              onChange={(e) => onChange({ dismissButton: meta.dismissButton ? { ...meta.dismissButton, capHours: Number(e.target.value) } : undefined })}
            />
          </div>
        </div>
        {dismissLabelDisabled ? (
          <p className="text-[10px] text-amber-500 mt-0.5">
            กรุณาตั้งค่าปุ่ม Dismiss จากภาษาไทยก่อน จึงจะแปลป้ายปุ่มได้
          </p>
        ) : (
          <p className="text-[10px] text-gray-400 mt-0.5">ชั่วโมงที่ไม่แสดงหลังกดปุ่มนี้ — 8760 = ถาวร</p>
        )}
      </div>

      {/* Enter animation */}
      <div>
        <label className={LABEL_CLASS} htmlFor={`${uid}-anim`}>
          ลูกเล่นตอนแสดง (Animation)
        </label>
        <Select id={`${uid}-anim`} className="w-full" value={meta.enterAnimation ?? 'fade'} onChange={(e) => onChange({ enterAnimation: e.target.value as PopupChrome['enterAnimation'] })}>
          <option value="none">ไม่มี</option>
          <option value="fade">Fade</option>
          <option value="slide-up">Slide Up</option>
          <option value="slide-down">Slide Down</option>
          <option value="zoom">Zoom</option>
        </Select>
      </div>

      {/* Background image */}
      <div>
        <label className={LABEL_CLASS} htmlFor={`${uid}-bg-image`}>
          URL รูปพื้นหลัง (ไม่บังคับ)
        </label>
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
              รูปแบบการแสดงรูปพื้นหลัง
            </label>
            <Select id={`${uid}-bg-image-style`} className="w-full mt-1" value={meta.backgroundImageStyle ?? 'cover'} onChange={(e) => onChange({ backgroundImageStyle: e.target.value as PopupChrome['backgroundImageStyle'] })}>
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="repeat">Repeat</option>
            </Select>
          </>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-gray-400">
        หน่วงเวลาแสดงหลัง popup ถูก enroll เพื่อไม่ให้กระพริบทันทีที่โหลดหน้า
      </p>
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
  const uid = useId();
  return (
    <div className="space-y-2.5 rounded-lg border border-gray-200 bg-white p-2.5">
      <p className="text-[10px] font-semibold tracking-wide text-gray-400">EMAIL CHROME</p>

      <div>
        <label className={LABEL_CLASS} htmlFor={`${uid}-content-width`}>
          ความกว้างเนื้อหา (px)
        </label>
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
          สีพื้นหลังนอกอีเมล
        </label>
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
          สีพื้นหลังการ์ดเนื้อหา
        </label>
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
        เนื้อหาอยู่กึ่งกลางอีเมลเสมอ — ความกว้างนี้คือขนาดสูงสุดของการ์ดเนื้อหา (ไม่ใช่ทั้งอีเมล)
      </p>
    </div>
  );
}

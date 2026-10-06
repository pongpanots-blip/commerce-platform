import { useId, useState, type ReactNode } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { POPUP_GRID_COLS } from '@josh/shared-api';
import { Select } from '@josh/shared-ui-web';
import { ImageSourceField } from './ImageSourceField';
import { SchemaDrivenFields, hasSchemaFieldsInGroup, isSchemaDrivenType } from './SchemaDrivenFields';
import { BREAKPOINT_LABELS, hasBreakpointOverride, isHiddenAt } from './breakpoint-style';
import type {
  BannerOption,
  Breakpoint,
  CouponOption,
  CreativeElement,
  CreativeI18nOverlay,
  CreativeRow,
  GridItem,
} from './creative-editor.types';

type OverlaySlide = { src?: string; alt?: string; linkUrl?: string };

/** Build a dense array (no holes) so a sparse edit (e.g. slide 2 before slide 0) never
 * produces `undefined` entries — those serialize to `null` via JSON.stringify and crash
 * the resolver on reload. */
function withDenseSlide(prev: OverlaySlide[] | undefined, idx: number, patch: Partial<OverlaySlide>): OverlaySlide[] {
  const base = prev ?? [];
  const next = Array.from({ length: Math.max(idx + 1, base.length) }, (_, i) => ({ ...(base[i] ?? {}) }));
  next[idx] = { ...next[idx], ...patch };
  return next;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-primary focus:outline-none';
const LABEL_CLASS = 'mb-1 block text-[10px] font-medium text-gray-500';

const ELEMENT_LABELS: Record<CreativeElement['type'], string> = {
  text: 'ข้อความ',
  image: 'รูปภาพ',
  button: 'ปุ่ม (Action)',
  coupon: 'โค้ดคูปอง',
  spacer: 'ระยะห่าง',
  divider: 'เส้นคั่น',
  video: 'วิดีโอ',
  html: 'HTML',
  countdown: 'นับถอยหลัง',
  carousel: 'สไลด์รูป',
  product_grid: 'กริดสินค้า',
  rich_text: 'ข้อความ (Rich Text)',
  accordion: 'แอคคอร์เดียน',
};

/**
 * A collapsible group of inspector fields.
 *
 * Purely presentational: it never touches the values inside it, so the
 * base-vs-overlay (i18n) routing and the breakpoint delta semantics of the
 * fields it wraps are unchanged.
 *
 * Collapse state is local, so mounting with `key={element.id}` (what
 * `ElementInspector` does) resets every section to its default the moment a
 * different element is selected — a marketer hunting for a field never
 * inherits a collapsed section from the previously selected element.
 */
export function InspectorSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between py-1.5 text-left text-[11px] font-medium text-gray-600 hover:text-gray-900"
      >
        <span>{title}</span>
        <span
          aria-hidden
          className={`text-[9px] text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
      </button>
      {open && <div className="space-y-2 pb-2">{children}</div>}
    </div>
  );
}

const SECTION_LABELS = {
  content: 'เนื้อหา',
  style: 'รูปแบบ',
  spacing: 'ระยะห่าง',
  display: 'การแสดงผลต่อจอ',
} as const;

/**
 * Which sections each hand-written element type contributes fields to, so a
 * type with nothing to say in a section gets no empty header. Schema-driven
 * types are answered by `hasSchemaFieldsInGroup` instead. `spacing` needs no
 * such set: every element has grid placement / column span, so it always renders.
 */
const TYPES_WITH_CONTENT = new Set<CreativeElement['type']>([
  'text',
  'image',
  'button',
  'coupon',
  'video',
  'html',
  'countdown',
  'carousel',
]);
const TYPES_WITH_STYLE = new Set<CreativeElement['type']>(['text', 'button', 'divider', 'video']);

const BUTTON_ACTION_OPTIONS: Array<{ value: 'go_url' | 'copy_code' | 'close'; label: string }> = [
  { value: 'go_url', label: 'ไปลิงก์ (เช่น หน้าตะกร้า/สินค้า)' },
  { value: 'copy_code', label: 'คัดลอกโค้ดคูปอง' },
  { value: 'close', label: 'ปิด popup' },
];

/**
 * Right-panel property editor for the currently-selected canvas element.
 *
 * Fields are grouped into four collapsible sections — เนื้อหา (open by default)
 * · รูปแบบ · ระยะห่าง · การแสดงผลต่อจอ — because a flat list of every control
 * was unusable at the inspector's 280px width. The grouping is presentation
 * only: which value each control reads and writes is unchanged.
 */
export function ElementInspector({
  element,
  coupons,
  banners,
  variables,
  onPatch,
  onRemove,
  gridItem,
  onPatchGridItem,
  editorLocale,
  overlay,
  onPatchOverlay,
  onPatchElementImages,
  breakpoint = 'base',
  onResetBreakpoint,
  onToggleHidden,
  rawElement,
}: {
  element: CreativeElement | null;
  coupons: CouponOption[];
  banners: BannerOption[];
  variables: Array<{ key: string; label: string }>;
  onPatch: (patch: Partial<CreativeElement>) => void;
  onRemove: () => void;
  gridItem?: GridItem;
  onPatchGridItem?: (patch: Partial<Omit<GridItem, 'elementId'>>) => void;
  editorLocale?: string;
  overlay?: CreativeI18nOverlay;
  onPatchOverlay?: (patch: Partial<CreativeI18nOverlay>) => void;
  onPatchElementImages?: (
    elementId: string,
    transform: (images: Array<{ src?: string; alt?: string; linkUrl?: string }>) => Array<{ src?: string; alt?: string; linkUrl?: string }>,
  ) => void;
  /** Page editor only: the viewport currently being edited. */
  breakpoint?: Breakpoint;
  onResetBreakpoint?: () => void;
  onToggleHidden?: (hidden: boolean) => void;
  /**
   * The un-resolved element. The page editor passes a `resolveResponsive`d copy
   * as `element` for display, so override/visibility state must be read here.
   */
  rawElement?: CreativeElement | null;
}) {
  const uid = useId();
  const translating = Boolean(editorLocale && editorLocale !== 'th' && onPatchOverlay);

  /** Value to show: the overlay when translating, else the base field. */
  const tvalue = (field: keyof CreativeI18nOverlay, base: string | undefined) =>
    translating ? ((overlay?.[field] as string | undefined) ?? '') : (base ?? '');

  /** Placeholder to show while translating: the Thai text being translated. */
  const tplaceholder = (base: string | undefined, fallback: string) =>
    translating ? (base ?? '') || fallback : fallback;

  // Override/visibility state lives on the un-resolved element; `element` may be
  // a resolved copy with `styleMd`/`styleLg` already flattened away.
  const source = rawElement ?? element;
  const overridden = Boolean(source) && hasBreakpointOverride(source as CreativeElement, breakpoint);
  const hidden = Boolean(source) && isHiddenAt(source as CreativeElement, breakpoint);

  if (!element) {
    return (
      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-2.5">
        <p className="text-[10px] font-semibold tracking-wide text-gray-400">องค์ประกอบที่เลือก</p>
        <p className="text-[11px] text-gray-400">
          คลิกองค์ประกอบบน canvas เพื่อแก้ไข · ลาก ⋮⋮ เพื่อย้ายข้ามคอลัมน์ · เลือก Layout แถว
          (1/2/3 คอลัมน์)
        </p>
      </div>
    );
  }

  const showContent =
    TYPES_WITH_CONTENT.has(element.type) || hasSchemaFieldsInGroup(element.type, 'content');
  const showStyle =
    TYPES_WITH_STYLE.has(element.type) || hasSchemaFieldsInGroup(element.type, 'style');

  return (
    <div className="space-y-1 rounded-lg border border-gray-200 bg-white p-2.5">
      <div className="flex items-center justify-between pb-1">
        <p className="text-xs font-semibold text-gray-700">{ELEMENT_LABELS[element.type]}</p>
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] text-red-500 hover:underline"
        >
          ลบ
        </button>
      </div>

      {showContent && (
        <InspectorSection key={`${element.id}-content`} title={SECTION_LABELS.content} defaultOpen>
          {isSchemaDrivenType(element.type) && (
            <SchemaDrivenFields
              element={element}
              onPatch={onPatch}
              translating={translating}
              overlay={overlay}
              onPatchOverlay={onPatchOverlay}
              group="content"
            />
          )}

          {element.type === 'text' && (
            <div className="space-y-1.5">
              <label className={LABEL_CLASS} htmlFor={`${uid}-text`}>
                ข้อความ
              </label>
              <textarea
                id={`${uid}-text`}
                rows={3}
                className={INPUT_CLASS}
                placeholder={tplaceholder(element.text, 'เช่น {{user_name}} ช้อปตอนนี้ลดพิเศษ')}
                value={tvalue('text', element.text)}
                onChange={(event) =>
                  translating
                    ? onPatchOverlay?.({ text: event.target.value })
                    : onPatch({ text: event.target.value } as Partial<CreativeElement>)
                }
              />
              <div className="flex flex-wrap gap-1">
                {variables.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    onClick={() =>
                      translating
                        ? onPatchOverlay?.({ text: `${overlay?.text ?? ''}{{${variable.key}}}` })
                        : onPatch({ text: `${element.text}{{${variable.key}}}` } as Partial<CreativeElement>)
                    }
                    className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-600 hover:border-primary hover:text-primary"
                    title={variable.label}
                  >
                    {'{{'}
                    {variable.key}
                    {'}}'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {element.type === 'image' && (
            <div className="space-y-1.5">
              <ImageSourceField
                label="รูปภาพ (URL)"
                value={tvalue('src', element.src)}
                basePreviewValue={translating ? element.src : undefined}
                onChange={(url) =>
                  translating ? onPatchOverlay?.({ src: url }) : onPatch({ src: url } as Partial<CreativeElement>)
                }
                banners={banners}
              />
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-alt`}>
                  คำอธิบายรูปภาพ (Alt text)
                </label>
                <input
                  id={`${uid}-alt`}
                  type="text"
                  className={INPUT_CLASS}
                  placeholder={tplaceholder(element.alt, 'คำอธิบายรูปภาพ')}
                  value={tvalue('alt', element.alt)}
                  onChange={(event) =>
                    translating
                      ? onPatchOverlay?.({ alt: event.target.value })
                      : onPatch({ alt: event.target.value } as Partial<CreativeElement>)
                  }
                />
              </div>
            </div>
          )}

          {element.type === 'button' && (
            <div className="space-y-1.5">
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-btn-label`}>
                  ข้อความบนปุ่ม
                </label>
                <input
                  id={`${uid}-btn-label`}
                  type="text"
                  className={INPUT_CLASS}
                  placeholder={tplaceholder(element.label, 'ข้อความบนปุ่ม เช่น ไปใช้ที่ตะกร้า')}
                  value={tvalue('label', element.label)}
                  onChange={(event) =>
                    translating
                      ? onPatchOverlay?.({ label: event.target.value })
                      : onPatch({ label: event.target.value } as Partial<CreativeElement>)
                  }
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-btn-action`}>
                  การทำงานเมื่อคลิก (Action)
                </label>
                <Select
                  id={`${uid}-btn-action`}
                  className="w-full"
                  value={element.action}
                  onChange={(event) =>
                    onPatch({ action: event.target.value as 'go_url' | 'copy_code' | 'close' } as Partial<CreativeElement>)
                  }
                >
                  {BUTTON_ACTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
              {element.action === 'go_url' && (
                <div>
                  <label className={LABEL_CLASS} htmlFor={`${uid}-btn-url`}>
                    ลิงก์ (URL)
                  </label>
                  <input
                    id={`${uid}-btn-url`}
                    type="text"
                    className={`${INPUT_CLASS} font-mono`}
                    placeholder={tplaceholder(element.url, '/cart/placement หรือ https://...')}
                    value={tvalue('url', element.url)}
                    onChange={(event) =>
                      translating
                        ? onPatchOverlay?.({ url: event.target.value })
                        : onPatch({ url: event.target.value } as Partial<CreativeElement>)
                    }
                  />
                </div>
              )}
            </div>
          )}

          {element.type === 'coupon' && (
            <div className="space-y-1.5">
              <label className={LABEL_CLASS} htmlFor={`${uid}-coupon`}>
                โค้ดคูปอง
              </label>
              <Select
                id={`${uid}-coupon`}
                className="w-full font-mono"
                value={element.legacyCode ?? ''}
                onChange={(event) =>
                  onPatch({ legacyCode: event.target.value || undefined } as Partial<CreativeElement>)
                }
              >
                <option value="">— เลือกคูปองจากระบบ —</option>
                {coupons.map((coupon) => (
                  <option key={coupon.id} value={coupon.coupon_code}>
                    {coupon.coupon_code} — {coupon.title}
                  </option>
                ))}
                {element.legacyCode && !coupons.some((c) => c.coupon_code === element.legacyCode) && (
                  <option value={element.legacyCode}>{element.legacyCode} (ไม่พบในระบบ)</option>
                )}
              </Select>
              <p className="text-[10px] text-gray-400">
                หน้าร้านจะแสดงโค้ดจริงของ offer ที่ enroll เสมอ — ค่านี้ใช้เป็นตัวอย่าง/สำรองเท่านั้น
              </p>
            </div>
          )}

          {element.type === 'video' && (
            <div className="space-y-2">
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-video-src`}>
                  URL วิดีโอ (YouTube / Vimeo / MP4)
                </label>
                <input id={`${uid}-video-src`} className={INPUT_CLASS} value={element.src} onChange={(e) => onPatch({ src: e.target.value } as Partial<CreativeElement>)} placeholder="https://youtube.com/watch?v=..." />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-video-mode`}>
                  โหมดเล่น
                </label>
                <Select id={`${uid}-video-mode`} className="w-full" value={element.playMode} onChange={(e) => onPatch({ playMode: e.target.value as 'auto' | 'click' } as Partial<CreativeElement>)}>
                  <option value="click">Click to play</option>
                  <option value="auto">Autoplay (muted)</option>
                </Select>
              </div>
            </div>
          )}

          {element.type === 'html' && (
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor={`${uid}-html`}>
                โค้ด HTML (Raw HTML)
              </label>
              <textarea
                id={`${uid}-html`}
                rows={6}
                className={`${INPUT_CLASS} font-mono text-xs`}
                placeholder={tplaceholder(element.html, '')}
                value={tvalue('html', element.html)}
                onChange={(e) =>
                  translating ? onPatchOverlay?.({ html: e.target.value }) : onPatch({ html: e.target.value } as Partial<CreativeElement>)
                }
              />
              <p className="text-[10px] text-amber-500">⚠ ตรวจสอบ HTML ก่อน — จะถูก sanitize ด้วย DOMPurify ก่อนแสดงในหน้าร้าน</p>
            </div>
          )}

          {element.type === 'countdown' && (
            <div className="space-y-2">
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-cd-target`}>
                  วันเวลาเป้าหมาย
                </label>
                <input id={`${uid}-cd-target`} type="datetime-local" className={INPUT_CLASS} value={element.targetDatetime.slice(0,16)} onChange={(e) => onPatch({ targetDatetime: new Date(e.target.value).toISOString() } as Partial<CreativeElement>)} />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-cd-format`}>
                  รูปแบบ
                </label>
                <Select id={`${uid}-cd-format`} className="w-full" value={element.format} onChange={(e) => onPatch({ format: e.target.value as 'dhms' | 'hms' | 'ms' } as Partial<CreativeElement>)}>
                  <option value="dhms">วัน:ชั่วโมง:นาที:วินาที</option>
                  <option value="hms">ชั่วโมง:นาที:วินาที</option>
                  <option value="ms">นาที:วินาที</option>
                </Select>
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-cd-expired`}>
                  ข้อความเมื่อหมดเวลา
                </label>
                <input
                  id={`${uid}-cd-expired`}
                  className={INPUT_CLASS}
                  value={tvalue('expiredText', element.expiredText)}
                  onChange={(e) =>
                    translating
                      ? onPatchOverlay?.({ expiredText: e.target.value })
                      : onPatch({ expiredText: e.target.value } as Partial<CreativeElement>)
                  }
                  placeholder={tplaceholder(element.expiredText, 'หมดเวลาแล้ว')}
                />
              </div>
            </div>
          )}

          {element.type === 'carousel' && (
            <div className="space-y-2">
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-carousel-autoplay`}>
                  เล่นสไลด์อัตโนมัติ (วินาที, 0 = ปิด)
                </label>
                <input id={`${uid}-carousel-autoplay`} type="number" min={0} className={INPUT_CLASS} value={element.autoPlaySeconds ?? 3} onChange={(e) => onPatch({ autoPlaySeconds: Number(e.target.value) } as Partial<CreativeElement>)} />
              </div>
              <label className={LABEL_CLASS}>รูปภาพ (ลากเรียงลำดับได้)</label>
              <DragDropContext onDragEnd={(result) => {
                if (!result.destination) return;
                const from = result.source.index;
                const to = result.destination.index;
                const reorder = (imgs: OverlaySlide[]) => {
                  const next = [...imgs];
                  const [moved] = next.splice(from, 1);
                  next.splice(to, 0, moved);
                  return next;
                };
                // Structural op — when overlay bookkeeping is available (popup editor),
                // always write the base (in both locales) AND reindex every locale's
                // positional overlay.images the same way, in one write. Otherwise (email
                // editor, which has no locale toggle yet) fall back to patching the base
                // element directly, same as before overlay bookkeeping existed.
                if (onPatchElementImages) onPatchElementImages(element.id, reorder);
                else onPatch({ images: reorder(element.images ?? []) } as Partial<CreativeElement>);
              }}>
                <Droppable droppableId="carousel-images">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1.5">
                      {(element.images ?? []).map((img, idx) => (
                        <Draggable key={idx} draggableId={String(idx)} index={idx}>
                          {(drag) => (
                            <div ref={drag.innerRef} {...drag.draggableProps} className="flex items-center gap-1 rounded border border-gray-200 bg-white p-1.5">
                              <span {...drag.dragHandleProps} className="cursor-grab text-gray-300">⋮⋮</span>
                              <div className="flex-1 space-y-1">
                                <ImageSourceField
                                  label={`รูปภาพสไลด์ที่ ${idx + 1} (URL)`}
                                  value={
                                    translating ? ((overlay?.images?.[idx]?.src as string | undefined) ?? '') : img.src
                                  }
                                  basePreviewValue={translating ? img.src : undefined}
                                  onChange={(url) => {
                                    if (translating) {
                                      onPatchOverlay?.({ images: withDenseSlide(overlay?.images, idx, { src: url }) });
                                      return;
                                    }
                                    const imgs = [...(element.images ?? [])];
                                    imgs[idx] = { ...imgs[idx], src: url };
                                    onPatch({ images: imgs } as Partial<CreativeElement>);
                                  }}
                                  banners={banners}
                                />
                                <input
                                  type="text"
                                  aria-label={`คำอธิบายรูปภาพสไลด์ที่ ${idx + 1} (Alt text)`}
                                  className={INPUT_CLASS}
                                  placeholder={tplaceholder(img.alt, 'Alt text')}
                                  value={translating ? ((overlay?.images?.[idx]?.alt as string | undefined) ?? '') : (img.alt ?? '')}
                                  onChange={(event) => {
                                    if (translating) {
                                      onPatchOverlay?.({
                                        images: withDenseSlide(overlay?.images, idx, { alt: event.target.value }),
                                      });
                                      return;
                                    }
                                    const imgs = [...(element.images ?? [])];
                                    imgs[idx] = { ...imgs[idx], alt: event.target.value };
                                    onPatch({ images: imgs } as Partial<CreativeElement>);
                                  }}
                                />
                                <input
                                  type="text"
                                  aria-label={`ลิงก์เมื่อคลิกสไลด์ที่ ${idx + 1} (URL, ไม่บังคับ)`}
                                  className={`${INPUT_CLASS} font-mono`}
                                  placeholder={tplaceholder(img.linkUrl, 'ลิงก์เมื่อคลิก (ไม่บังคับ)')}
                                  value={
                                    translating
                                      ? ((overlay?.images?.[idx]?.linkUrl as string | undefined) ?? '')
                                      : (img.linkUrl ?? '')
                                  }
                                  onChange={(event) => {
                                    if (translating) {
                                      onPatchOverlay?.({
                                        images: withDenseSlide(overlay?.images, idx, { linkUrl: event.target.value }),
                                      });
                                      return;
                                    }
                                    const imgs = [...(element.images ?? [])];
                                    imgs[idx] = { ...imgs[idx], linkUrl: event.target.value };
                                    onPatch({ images: imgs } as Partial<CreativeElement>);
                                  }}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const remove = (imgs: OverlaySlide[]) => {
                                    const next = [...imgs];
                                    next.splice(idx, 1);
                                    return next;
                                  };
                                  // Structural op (shared across locales) — deletes the base slide
                                  // (and its overlay, via onPatchElementImages) in every locale,
                                  // including while translating in EN mode. When overlay
                                  // bookkeeping isn't wired up (email editor), fall back to
                                  // patching the base element directly.
                                  if (onPatchElementImages) onPatchElementImages(element.id, remove);
                                  else onPatch({ images: remove(element.images ?? []) } as Partial<CreativeElement>);
                                }}
                                className="text-red-400 hover:text-red-600"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
              {translating ? (
                <p className="text-center text-[11px] text-gray-400">
                  เพิ่ม/ลบรูปภาพได้เฉพาะในโหมดไทยเท่านั้น
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const add = (imgs: OverlaySlide[]) => [...imgs, { src: '', alt: '' }];
                    if (onPatchElementImages) onPatchElementImages(element.id, add);
                    else onPatch({ images: add(element.images ?? []) } as Partial<CreativeElement>);
                  }}
                  className="w-full rounded border border-dashed border-gray-300 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
                >
                  + เพิ่มรูปภาพ
                </button>
              )}
            </div>
          )}
        </InspectorSection>
      )}

      {showStyle && (
        <InspectorSection key={`${element.id}-style`} title={SECTION_LABELS.style}>
          {isSchemaDrivenType(element.type) && (
            <SchemaDrivenFields
              element={element}
              onPatch={onPatch}
              translating={translating}
              overlay={overlay}
              onPatchOverlay={onPatchOverlay}
              group="style"
            />
          )}

          {element.type === 'text' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className={LABEL_CLASS} htmlFor={`${uid}-text-align`}>
                    การจัดวางข้อความ
                  </label>
                  <Select
                    id={`${uid}-text-align`}
                    className="w-full"
                    value={element.style?.align ?? 'left'}
                    onChange={(event) =>
                      onPatch({
                        style: { ...element.style, align: event.target.value as 'left' | 'center' | 'right' },
                      } as Partial<CreativeElement>)
                    }
                  >
                    <option value="left">ชิดซ้าย</option>
                    <option value="center">กึ่งกลาง</option>
                    <option value="right">ชิดขวา</option>
                  </Select>
                </div>
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-gray-500">
                  <input
                    type="checkbox"
                    checked={element.style?.fontWeight === 'bold'}
                    onChange={(event) =>
                      onPatch({
                        style: { ...element.style, fontWeight: event.target.checked ? 'bold' : 'normal' },
                      } as Partial<CreativeElement>)
                    }
                  />
                  ตัวหนา
                </label>
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-text-fontsize`}>
                  ขนาดตัวอักษร ({element.style?.fontSizePx ?? 14}px)
                </label>
                <input
                  id={`${uid}-text-fontsize`}
                  type="range"
                  min={10}
                  max={36}
                  step={1}
                  className="w-full"
                  value={element.style?.fontSizePx ?? 14}
                  onChange={(event) =>
                    onPatch({
                      style: {
                        ...element.style,
                        fontSizePx: Number(event.target.value) || 14,
                      },
                    } as Partial<CreativeElement>)
                  }
                />
              </div>
            </div>
          )}

          {element.type === 'button' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL_CLASS} id={`${uid}-btn-bg-label`}>
                  สีพื้นหลัง
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    aria-labelledby={`${uid}-btn-bg-label`}
                    className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                    value={
                      /^#[0-9a-f]{6}$/i.test(element.style?.backgroundColor ?? '')
                        ? (element.style!.backgroundColor as string)
                        : element.action === 'go_url'
                          ? '#171717'
                          : '#ffffff'
                    }
                    onChange={(event) =>
                      onPatch({
                        style: { ...element.style, backgroundColor: event.target.value },
                      } as Partial<CreativeElement>)
                    }
                  />
                  <input
                    type="text"
                    aria-labelledby={`${uid}-btn-bg-label`}
                    className={`${INPUT_CLASS} font-mono`}
                    placeholder="#171717"
                    value={element.style?.backgroundColor ?? ''}
                    onChange={(event) =>
                      onPatch({
                        style: {
                          ...element.style,
                          backgroundColor: event.target.value || undefined,
                        },
                      } as Partial<CreativeElement>)
                    }
                  />
                </div>
              </div>
              <div>
                <label className={LABEL_CLASS} id={`${uid}-btn-fg-label`}>
                  สีข้อความ
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    aria-labelledby={`${uid}-btn-fg-label`}
                    className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                    value={
                      /^#[0-9a-f]{6}$/i.test(element.style?.color ?? '')
                        ? (element.style!.color as string)
                        : element.action === 'go_url'
                          ? '#ffffff'
                          : '#262626'
                    }
                    onChange={(event) =>
                      onPatch({
                        style: { ...element.style, color: event.target.value },
                      } as Partial<CreativeElement>)
                    }
                  />
                  <input
                    type="text"
                    aria-labelledby={`${uid}-btn-fg-label`}
                    className={`${INPUT_CLASS} font-mono`}
                    placeholder="#ffffff"
                    value={element.style?.color ?? ''}
                    onChange={(event) =>
                      onPatch({
                        style: {
                          ...element.style,
                          color: event.target.value || undefined,
                        },
                      } as Partial<CreativeElement>)
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {element.type === 'divider' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-divider-color`}>
                  สี
                </label>
                <input
                  id={`${uid}-divider-color`}
                  type="color"
                  className="h-8 w-full cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                  value={element.style?.color ?? '#e5e5e5'}
                  onChange={(event) =>
                    onPatch({ style: { ...element.style, color: event.target.value } } as Partial<CreativeElement>)
                  }
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor={`${uid}-divider-thickness`}>
                  ความหนา (px)
                </label>
                <input
                  id={`${uid}-divider-thickness`}
                  type="number"
                  min={1}
                  className={INPUT_CLASS}
                  value={element.style?.thicknessPx ?? 1}
                  onChange={(event) =>
                    onPatch({
                      style: { ...element.style, thicknessPx: Number(event.target.value) || 1 },
                    } as Partial<CreativeElement>)
                  }
                />
              </div>
            </div>
          )}

          {element.type === 'video' && (
            <div>
              <label className={LABEL_CLASS} htmlFor={`${uid}-video-ratio`}>
                สัดส่วนภาพ (Aspect Ratio)
              </label>
              <Select id={`${uid}-video-ratio`} className="w-full" value={element.style?.aspectRatio ?? '16/9'} onChange={(e) => onPatch({ style: { ...element.style, aspectRatio: e.target.value as '16/9' | '4/3' | '1/1' } } as Partial<CreativeElement>)}>
                <option value="16/9">16:9</option>
                <option value="4/3">4:3</option>
                <option value="1/1">1:1</option>
              </Select>
            </div>
          )}
        </InspectorSection>
      )}

      <InspectorSection key={`${element.id}-spacing`} title={SECTION_LABELS.spacing}>
        {gridItem && onPatchGridItem && (
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['col', `คอลัมน์เริ่ม (0–${POPUP_GRID_COLS - 1})`, 0, POPUP_GRID_COLS - 1],
                ['colSpan', 'กว้าง (ช่อง)', 1, POPUP_GRID_COLS],
                ['row', 'แถวเริ่ม', 0, 99],
                ['rowSpan', 'สูง (แถว)', 1, 99],
              ] as const
            ).map(([field, label, min, max]) => (
              <div key={field}>
                <label className={LABEL_CLASS} htmlFor={`${uid}-grid-${field}`}>
                  {label}
                </label>
                <input
                  id={`${uid}-grid-${field}`}
                  type="number"
                  min={min}
                  max={max}
                  className={INPUT_CLASS}
                  value={gridItem[field]}
                  onChange={(event) => onPatchGridItem({ [field]: Number(event.target.value) || 0 })}
                />
              </div>
            ))}
          </div>
        )}

        {!gridItem && (
          <div>
            <label className={LABEL_CLASS} htmlFor={`${uid}-colspan`}>
              ครอบคลุมกี่คอลัมน์ (span) — ลากไปคอลัมน์เริ่มต้นก่อน
            </label>
            <Select
              id={`${uid}-colspan`}
              className="w-full"
              value={element.columnSpan ?? 1}
              onChange={(event) =>
                onPatch({
                  columnSpan: Number(event.target.value) || 1,
                } as Partial<CreativeElement>)
              }
            >
              <option value={1}>1 คอลัมน์ (อยู่ช่องนี้เท่านั้น)</option>
              <option value={2}>2 คอลัมน์</option>
              <option value={3}>3 คอลัมน์ (คลุมเกือบทั้งแถว)</option>
            </Select>
            <p className="mt-0.5 text-[10px] text-gray-400">
              เช่น ข้อความอยู่แค่คอลัมน์ 2 → ลากไปช่องกลาง + span 1 · ปุ่มคลุมทั้งแถว 3 ช่อง →
              ลากไปช่องซ้าย + span 3
            </p>
          </div>
        )}

        {(element.type === 'image' || element.type === 'video' || element.type === 'carousel') && (
          <div>
            <label className={LABEL_CLASS} htmlFor={`${uid}-widthpercent`}>
              ความกว้าง (%)
            </label>
            <input
              id={`${uid}-widthpercent`}
              type="number"
              min={10}
              max={100}
              className={INPUT_CLASS}
              value={element.style?.widthPercent ?? 100}
              onChange={(event) =>
                onPatch({
                  style: { ...element.style, widthPercent: Number(event.target.value) || 100 },
                } as Partial<CreativeElement>)
              }
            />
          </div>
        )}

        {element.type === 'button' && (
          <div>
            <label className={LABEL_CLASS} htmlFor={`${uid}-btn-width`}>
              ความกว้างในช่อง ({element.style?.fullWidth !== false ? 100 : (element.style?.widthPercent ?? 100)}%)
            </label>
            <input
              id={`${uid}-btn-width`}
              type="range"
              min={20}
              max={100}
              step={5}
              className="w-full"
              value={element.style?.fullWidth !== false ? 100 : (element.style?.widthPercent ?? 100)}
              onChange={(event) => {
                const next = Number(event.target.value) || 100;
                onPatch({
                  style: {
                    ...element.style,
                    widthPercent: next,
                    // <100 → partial width; 100 → fill the grid cell
                    fullWidth: next >= 100,
                  },
                } as Partial<CreativeElement>);
              }}
            />
            <p className="mt-0.5 text-[10px] text-gray-400">
              สองปุ่มข้างกัน = ลากขยายช่องบน grid ให้คนละครึ่ง · ความกว้างนี้คือในช่อง (ปกติ 100%)
            </p>
          </div>
        )}

        {element.type === 'spacer' && (
          <div>
            <label className={LABEL_CLASS} htmlFor={`${uid}-spacer-height`}>
              ความสูง (px)
            </label>
            <input
              id={`${uid}-spacer-height`}
              type="number"
              min={0}
              className={INPUT_CLASS}
              value={element.heightPx}
              onChange={(event) => onPatch({ heightPx: Number(event.target.value) || 0 } as Partial<CreativeElement>)}
            />
          </div>
        )}
      </InspectorSection>

      {/* Only meaningful while a non-base viewport is being edited — at base
          there is no override banner and no per-breakpoint hide toggle, so the
          section is omitted rather than rendered empty. Open by default because
          it carries mode state the user needs to see, not occasional fields. */}
      {breakpoint !== 'base' && (
        <InspectorSection key={`${element.id}-display`} title={SECTION_LABELS.display} defaultOpen>
          <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[10px] text-amber-700">
                {overridden ? (
                  <>
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    กำลังแก้เฉพาะ {BREAKPOINT_LABELS[breakpoint]} — มีค่าเฉพาะจอนี้อยู่
                  </>
                ) : (
                  <>กำลังแก้เฉพาะ {BREAKPOINT_LABELS[breakpoint]} — ยังใช้ค่าจาก base</>
                )}
              </span>
              {overridden && onResetBreakpoint && (
                <button
                  type="button"
                  onClick={onResetBreakpoint}
                  className="shrink-0 text-[10px] font-medium text-amber-700 underline hover:text-amber-900"
                >
                  รีเซ็ตกลับ base
                </button>
              )}
            </div>
            {onToggleHidden && (
              <label className="flex items-center gap-1.5 text-[10px] text-amber-700">
                <input
                  type="checkbox"
                  aria-label={`ซ่อนองค์ประกอบนี้บน ${BREAKPOINT_LABELS[breakpoint]}`}
                  checked={hidden}
                  onChange={(event) => onToggleHidden(event.target.checked)}
                />
                ซ่อนองค์ประกอบนี้บน{BREAKPOINT_LABELS[breakpoint]}
              </label>
            )}
          </div>
        </InspectorSection>
      )}
    </div>
  );
}

/** Optional fine-tune of column widthPercent after picking a 2/3 layout preset. */
export function RowLayoutInspector({
  rows,
  onChangeColumnWidth,
}: {
  rows: CreativeRow[];
  onChangeColumnWidth: (rowId: string, columnId: string, widthPercent: number) => void;
}) {
  const uid = useId();
  const collect = (list: CreativeRow[], labelPrefix: string): Array<{ row: CreativeRow; label: string }> => {
    const out: Array<{ row: CreativeRow; label: string }> = [];
    list.forEach((row, index) => {
      const label = `${labelPrefix}${index + 1}`;
      if (row.columns.length > 1) out.push({ row, label });
      row.columns.forEach((column, colIndex) => {
        if (column.rows?.length) {
          out.push(...collect(column.rows, `${label}.${colIndex + 1}.`));
        }
      });
    });
    return out;
  };

  const multiColumnRows = collect(rows, '');
  if (multiColumnRows.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-2.5">
      <p className="text-[10px] font-semibold tracking-wide text-gray-400">
        ปรับสัดส่วนคอลัมน์ละเอียด (%)
      </p>
      {multiColumnRows.map(({ row, label }) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] text-gray-400">แถว {label}</span>
          {row.columns.map((column, colIndex) => (
            <div key={column.id} className="flex items-center gap-1">
              <label className="text-[10px] text-gray-400" htmlFor={`${uid}-${column.id}`}>
                คอลัมน์ {colIndex + 1}
              </label>
              <input
                id={`${uid}-${column.id}`}
                type="number"
                min={1}
                max={100}
                className={`${INPUT_CLASS} w-16`}
                value={column.widthPercent}
                onChange={(event) =>
                  onChangeColumnWidth(row.id, column.id, Number(event.target.value) || 0)
                }
              />
              <span className="text-[10px] text-gray-400">%</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

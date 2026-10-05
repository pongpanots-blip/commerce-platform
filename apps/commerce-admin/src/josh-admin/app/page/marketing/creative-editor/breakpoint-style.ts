import type { Breakpoint, CreativeElement } from './creative-editor.types';

/**
 * Canvas widths used by the viewport switcher. These are representative device
 * widths inside each Tailwind range (base < 768, md 768–1023, lg >= 1024) —
 * not the breakpoint boundaries themselves, so what the marketer sees is a
 * plausible real screen rather than the exact edge case.
 */
export const PAGE_CANVAS_WIDTH_PX: Record<Breakpoint, number> = {
  base: 390,
  md: 768,
  lg: 1200,
};

export const BREAKPOINT_LABELS: Record<Breakpoint, string> = {
  base: 'มือถือ',
  md: 'แท็บเล็ต',
  lg: 'เดสก์ท็อป',
};

export const BREAKPOINT_ORDER: Breakpoint[] = ['base', 'md', 'lg'];

type StyleKey = 'style' | 'styleMd' | 'styleLg';
type StyleBag = Record<string, unknown>;

export function styleKeyForBreakpoint(breakpoint: Breakpoint): StyleKey {
  if (breakpoint === 'md') return 'styleMd';
  if (breakpoint === 'lg') return 'styleLg';
  return 'style';
}

function styleBag(element: CreativeElement, key: StyleKey): StyleBag {
  const value = (element as unknown as Record<string, unknown>)[key];
  return value && typeof value === 'object' ? (value as StyleBag) : {};
}

/**
 * The style an element already resolves to at `breakpoint` *without* that
 * breakpoint's own override — the yardstick a new edit is measured against.
 * `lg` inherits `md`, matching `resolveResponsive`.
 */
function inheritedStyle(element: CreativeElement, breakpoint: Breakpoint): StyleBag {
  if (breakpoint === 'lg') {
    return { ...styleBag(element, 'style'), ...styleBag(element, 'styleMd') };
  }
  return { ...styleBag(element, 'style') };
}

/**
 * Route an inspector patch to the style bucket of the active breakpoint.
 *
 * Only `style` is per-breakpoint. Content fields (text, src, items, ...) stay
 * shared: a marketer editing copy at the `lg` viewport expects that copy to
 * change everywhere, not to fork silently per screen size.
 *
 * The inspector edits a *resolved* element, so `patch.style` arrives as a full
 * style object. Only the keys that actually differ from what the element already
 * inherits are stored, keeping overrides minimal — otherwise every field would
 * read as "overridden at this breakpoint" after a single edit, and resetting to
 * base would silently wipe values the marketer never touched.
 */
export function redirectStylePatch(
  patch: Partial<CreativeElement>,
  breakpoint: Breakpoint,
  element: CreativeElement,
): Partial<CreativeElement> {
  if (breakpoint === 'base') return patch;
  if (!('style' in patch)) return patch;

  const { style, ...rest } = patch as { style?: StyleBag } & StyleBag;
  const inherited = inheritedStyle(element, breakpoint);
  const key = styleKeyForBreakpoint(breakpoint);
  const next: StyleBag = { ...styleBag(element, key) };

  for (const [field, value] of Object.entries(style ?? {})) {
    if (value === undefined || value === inherited[field]) delete next[field];
    else next[field] = value;
  }

  return {
    ...rest,
    [key]: Object.keys(next).length > 0 ? next : undefined,
  } as Partial<CreativeElement>;
}

/** True when this element carries its own (non-empty) style at `breakpoint`. */
export function hasBreakpointOverride(element: CreativeElement, breakpoint: Breakpoint): boolean {
  if (breakpoint === 'base') return false;
  return Object.keys(styleBag(element, styleKeyForBreakpoint(breakpoint))).length > 0;
}

/** Patch that removes the breakpoint override so the element falls back to base. */
export function clearBreakpointOverride(breakpoint: Breakpoint): Partial<CreativeElement> {
  if (breakpoint === 'base') return {};
  return { [styleKeyForBreakpoint(breakpoint)]: undefined } as Partial<CreativeElement>;
}

/** True when the element is hidden at `breakpoint` via `hiddenOn`. */
export function isHiddenAt(element: CreativeElement, breakpoint: Breakpoint): boolean {
  return (element.hiddenOn ?? []).includes(breakpoint);
}

/**
 * Patch that adds/removes `breakpoint` from `hiddenOn`. The key is dropped
 * entirely when nothing is hidden, so designs that never use the control stay
 * byte-identical to before (popup/email layouts must not grow the field).
 */
export function toggleHiddenAt(
  element: CreativeElement,
  breakpoint: Breakpoint,
  hidden: boolean,
): Partial<CreativeElement> {
  const current = element.hiddenOn ?? [];
  const next = hidden
    ? Array.from(new Set([...current, breakpoint]))
    : current.filter((item) => item !== breakpoint);
  return { hiddenOn: next.length > 0 ? next : undefined } as Partial<CreativeElement>;
}

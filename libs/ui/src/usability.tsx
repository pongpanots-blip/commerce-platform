import { ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ICONS } from './icons';
import { pageGuide } from './page-guides';
import { uiText, useUiLocale } from './i18n';

function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const Glyph = ICONS[name] ?? ICONS.circle;
  return <Glyph size={size} className={cx('shrink-0', className)} aria-hidden="true" focusable="false" />;
}

function ChromeButton({ variant, children, onClick }: { variant: 'primary' | 'danger' | 'ghost'; children: ReactNode; onClick: () => void }) {
  const styles = {
    primary: 'bg-primary text-on-primary border-primary',
    danger: 'bg-[#c2333f] text-white border-[#c2333f]',
    ghost: 'bg-transparent text-on-surface-variant border-transparent hover:bg-surface-container-low',
  }[variant];
  return <button type="button" className={cx('inline-flex min-h-10 items-center justify-center rounded-lg border px-3.5 py-2 text-[13px] font-medium', styles)} onClick={onClick}>{children}</button>;
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Example shown in an empty field. Date, file, and choice controls keep the browser's own prompt. */
export function fieldExample(type?: string): string | undefined {
  switch (type) {
    case 'email': return 'name@shop.com';
    case 'tel': return '0812345678';
    case 'number': return '10';
    case 'url': return 'https://example.com';
    case 'search':
    case 'password':
    case 'date':
    case 'time':
    case 'datetime-local':
    case 'file':
    case 'checkbox':
    case 'radio':
    case 'color':
    case 'range':
    case 'select':
    default:
      return undefined;
  }
}

/** Short line under a field when the page did not write its own. */
export function fieldHint(required?: boolean): string {
  return required ? 'จำเป็น ดูตัวอย่างในช่อง แล้วพิมพ์ค่าจริง' : 'ไม่จำเป็น เว้นว่างได้';
}

/** One short line under a label or control. */
export function HelpText({ children, className }: { children: ReactNode; className?: string }) {
  useUiLocale();
  return <p className={cx('text-[11px] leading-relaxed text-on-surface-variant', className)}>{typeof children === 'string' ? uiText(children) : children}</p>;
}

/** Empty list or search: what happened, what to do, one button. */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
}: {
  icon?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  useUiLocale();
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Icon name={icon} size={28} className="text-outline-variant" />
      <p className="text-sm font-medium text-on-surface">{typeof title === 'string' ? uiText(title) : title}</p>
      {description && <div className="max-w-md text-xs leading-relaxed text-on-surface-variant">{typeof description === 'string' ? uiText(description) : description}</div>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

/** Search and filters in one bar above a list. */
export function FilterBar({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-2 border-b border-secondary-container p-4 md:px-5">
      <div className="flex flex-wrap items-end gap-3">{children}</div>
      {hint && <HelpText>{hint}</HelpText>}
    </div>
  );
}

/** Numbered steps for a task that stays on one page. */
export function Stepper({ steps }: { steps: string[] }) {
  useUiLocale();
  return (
    <ol className="flex flex-wrap gap-2" aria-label={uiText('ขั้นตอน')}>
      {steps.map((step, index) => (
        <li key={step} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-secondary-container bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-on-primary">{index + 1}</span>
          <span>{uiText(step)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Commerce-admin turns this on from its entry file. The portal never does. */
let pageGuidesEnabled = false;
export function enablePageGuides() { pageGuidesEnabled = true; }

/** Small help control beside a title. Closed until opened, and not remembered. */
export function PageHelpLink() {
  useUiLocale();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const guide = pageGuidesEnabled ? pageGuide(pathname) : undefined;
  useEffect(() => setOpen(false), [pathname]);
  if (!guide) return null;
  return (
    <span className="relative inline-flex">
      <button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary-container/40" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <Icon name="help" size={16} />
        {uiText('ช่วยเหลือ')}
      </button>
      {open && (
        <div id={panelId} className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[80vw] space-y-2 rounded-xl border border-secondary-container bg-surface-container-lowest p-3 shadow-lg">
          <p className="text-sm leading-relaxed text-on-surface-variant">{uiText(guide.summary)}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-on-surface">
            {guide.steps.map((step) => <li key={step}>{uiText(step)}</li>)}
          </ol>
        </div>
      )}
    </span>
  );
}

/** @deprecated The page title help link replaced the open box. */
export function HowTo({ summary, steps }: { id?: string; summary: string; steps: string[] }) {
  useUiLocale();
  return (
    <div className="space-y-2">
      <p className="text-sm leading-relaxed text-on-surface-variant">{uiText(summary)}</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-on-surface">{steps.map((step) => <li key={step}>{uiText(step)}</li>)}</ol>
    </div>
  );
}

export function RouteHowTo() {
  return <PageHelpLink />;
}

type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & { resolve: (ok: boolean) => void };
let pendingConfirm: PendingConfirm | null = null;
const confirmSubs = new Set<() => void>();

function emitConfirm() {
  for (const subscriber of confirmSubs) subscriber();
}

/** Ask before a destructive or hard-to-undo action. Resolves false when cancelled. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    pendingConfirm = { ...options, resolve };
    emitConfirm();
  });
}

export function useConfirm() {
  return confirmAction;
}

/** Dialog host. Mounted by page chrome; call confirmAction or useConfirm to open it. */
export const ConfirmDialog = ConfirmHost;

export function ConfirmHost() {
  useUiLocale();
  const current = useSyncExternalStore(
    (callback) => { confirmSubs.add(callback); return () => { confirmSubs.delete(callback); }; },
    () => pendingConfirm,
    () => null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!current || !node) return;
    node.showModal();
    return () => { node.close(); };
  }, [current]);
  if (!current) return null;
  function close(ok: boolean) {
    current?.resolve(ok);
    pendingConfirm = null;
    emitConfirm();
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-secondary-container bg-surface-container-lowest p-0 shadow-xl backdrop:bg-inverse-surface/40"
      onCancel={(event) => { event.preventDefault(); close(false); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(false); }}
    >
      <div className="space-y-2 px-4 py-4">
        <h2 id={titleId} className="text-base font-semibold text-on-surface">{uiText(current.title)}</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-on-surface-variant">{uiText(current.body)}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-secondary-container px-4 py-3">
        <ChromeButton variant="ghost" onClick={() => close(false)}>{uiText(current.cancelLabel ?? 'ยกเลิก')}</ChromeButton>
        <ChromeButton variant={current.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{uiText(current.confirmLabel ?? 'ยืนยัน')}</ChromeButton>
      </div>
    </dialog>
  );
}

type ToastAction = { label: string; href?: string; onClick?: () => void };
type ToastItem = { id: number; message: string; action?: ToastAction };
let toasts: ToastItem[] = [];
let toastSeq = 0;
const toastSubs = new Set<() => void>();

function emitToast() {
  for (const subscriber of toastSubs) subscriber();
}

/** Short confirmation plus an optional next step. Stays up for a few seconds. */
export function toast(message: string, action?: ToastAction) {
  const id = ++toastSeq;
  toasts = [...toasts, { id, message, action }];
  emitToast();
  window.setTimeout(() => {
    toasts = toasts.filter((item) => item.id !== id);
    emitToast();
  }, 7000);
}

export function ToastHost() {
  useUiLocale();
  const items = useSyncExternalStore(
    (callback) => { toastSubs.add(callback); return () => { toastSubs.delete(callback); }; },
    () => toasts,
    () => [],
  );
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(100%-2rem,22rem)] flex-col gap-2" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="pointer-events-auto rounded-xl border border-secondary-container bg-surface-container-lowest px-4 py-3 shadow-lg">
          <p className="text-sm text-on-surface">{uiText(item.message)}</p>
          {item.action && (
            item.action.href
              ? <Link to={item.action.href} className="mt-1 inline-flex text-sm font-medium text-primary hover:underline">{uiText(item.action.label)}</Link>
              : <button type="button" className="mt-1 text-sm font-medium text-primary hover:underline" onClick={item.action.onClick}>{uiText(item.action.label)}</button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Hosts for confirm and toast. The help link sits on the page title, not above it. */
export function PageChrome({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <ConfirmHost />
      <ToastHost />
    </>
  );
}

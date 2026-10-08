import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ICONS } from './icons';
import { formatUiMessage, uiText, useUiLocale } from './i18n';
import { confirmAction } from './usability';

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Glyph = ICONS[name] ?? ICONS.circle;
  return <Glyph size={size} className="shrink-0" aria-hidden="true" focusable="false" />;
}

/** Titled group of fields. `collapsed` hides optional groups until the person opens them. */
export function FormSection({
  title,
  description,
  children,
  collapsed = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  collapsed?: boolean;
}) {
  useUiLocale();
  const body = (
    <div className="space-y-4">
      {description && <p className="text-xs leading-relaxed text-on-surface-variant">{uiText(description)}</p>}
      {children}
    </div>
  );
  if (collapsed) {
    return (
      <details className="rounded-xl border border-secondary-container bg-surface-container-lowest">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-on-surface [&::-webkit-details-marker]:hidden">
          {uiText(title)}
        </summary>
        <div className="space-y-3 px-4 pb-4">{body}</div>
      </details>
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-on-surface">{uiText(title)}</h2>
      {body}
    </section>
  );
}

/** Sticky Cancel + a primary button named for the thing it saves. */
export function FormActions({
  saveLabel,
  cancelLabel = 'ยกเลิก',
  saving = false,
  onCancel,
  onSave,
}: {
  saveLabel: ReactNode;
  cancelLabel?: string;
  saving?: boolean;
  onCancel?: () => void;
  /** When set, the primary button does not submit a parent form. */
  onSave?: () => void;
}) {
  useUiLocale();
  return (
    <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-secondary-container bg-white/95 p-3 shadow-sm backdrop-blur-sm">
      {onCancel && (
        <button type="button" className="inline-flex min-h-10 items-center rounded-lg border border-secondary-container px-3.5 text-[13px] font-medium text-on-surface" onClick={onCancel} disabled={saving}>
          {uiText(cancelLabel)}
        </button>
      )}
      <button type={onSave ? 'button' : 'submit'} className="inline-flex min-h-10 items-center rounded-lg bg-primary px-3.5 text-[13px] font-medium text-on-primary disabled:opacity-60" disabled={saving} onClick={onSave}>
        {saving ? uiText('กำลังบันทึก...') : typeof saveLabel === 'string' ? uiText(saveLabel) : saveLabel}
      </button>
    </div>
  );
}

/** Ask before leaving a form that has been edited. Reload is covered by the browser prompt. */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return async function requestLeave(go: () => void) {
    if (!dirty) {
      go();
      return;
    }
    const ok = await confirmAction({
      title: 'ละทิ้งการเปลี่ยนแปลง?',
      body: 'สิ่งที่แก้ไว้ยังไม่ถูกบันทึก และจะหายไปถ้าออกจากหน้านี้',
      confirmLabel: 'ละทิ้งการเปลี่ยนแปลง',
      cancelLabel: 'อยู่หน้านี้ต่อ',
      danger: true,
    });
    if (ok) go();
  };
}

export function scrollToFirstInvalid(root: ParentNode | null | undefined) {
  const node = root?.querySelector('[aria-invalid="true"]');
  if (node instanceof HTMLElement) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Empty required field, after blur. The message names an example. */
export function blankFieldMessage(label: string, example?: string) {
  return formatUiMessage('กรอก{0} ตัวอย่าง: {1}', { 0: label, 1: example || '—' });
}

/** Detail title, status, a few facts, the main action, and destructive actions in a menu. */
export function DetailHeader({
  back,
  title,
  status,
  facts,
  primary,
  overflow,
}: {
  back?: { to: string; label: string };
  title: ReactNode;
  status?: ReactNode;
  facts?: { label: string; value: ReactNode }[];
  primary?: ReactNode;
  overflow?: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  useUiLocale();
  return (
    <header className="space-y-3">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Icon name="arrow_back" size={14} />
          {uiText(back.label)}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-on-surface">{title}</h1>
            {status}
          </div>
          {facts && facts.length > 0 && (
            <dl className="flex flex-wrap gap-x-6 gap-y-1">
              {facts.map((fact) => (
                <div key={fact.label} className="flex items-baseline gap-2">
                  <dt className="text-xs text-on-surface-variant">{uiText(fact.label)}</dt>
                  <dd className="text-sm text-on-surface">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {primary}
          {overflow && overflow.length > 0 && (
            <details className="relative">
              <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-secondary-container px-3 text-[13px] font-medium text-on-surface [&::-webkit-details-marker]:hidden">
                {uiText('การทำงานอื่น')}
              </summary>
              <div className="absolute right-0 z-30 mt-1 min-w-52 rounded-lg border border-secondary-container bg-white py-1 shadow-lg">
                {overflow.map((item) => (
                  <button key={item.label} type="button" className={cx('block w-full px-3 py-2 text-left text-sm hover:bg-surface-container-low', item.danger && 'text-[#c2333f]')} onClick={item.onSelect}>
                    {uiText(item.label)}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </header>
  );
}

/** An identifier: readable, secondary, and copyable. */
export function CopyableId({ value }: { value: string }) {
  useUiLocale();
  const [copied, setCopied] = useState(false);
  if (!value) return <>—</>;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-on-surface-variant">
      <span className="break-all">{value}</span>
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-primary hover:bg-surface-container-low"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <Icon name="content_copy" size={14} />
        {uiText(copied ? 'คัดลอกแล้ว' : 'คัดลอก')}
      </button>
    </span>
  );
}

/** Stop a submit, then move to the first field that says how to fix it. */
export function invalidSubmit(event: FormEvent<HTMLFormElement>) {
  const form = event.currentTarget;
  const bad = form.querySelector('[aria-invalid="true"]');
  if (bad instanceof HTMLElement) {
    event.preventDefault();
    bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  return false;
}

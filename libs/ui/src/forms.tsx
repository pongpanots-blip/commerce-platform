import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

// Each mounted form owns its registration. Mounting, saving or closing another
// form must never clear the unsaved edits of a form that remains on screen.
const unsavedForms = new Set<symbol>();

function askToLeave() {
  return confirmAction({
    title: 'ละทิ้งการเปลี่ยนแปลง?',
    body: 'สิ่งที่แก้ไว้ยังไม่ถูกบันทึก และจะหายไปถ้าออกจากหน้านี้',
    confirmLabel: 'ละทิ้งการเปลี่ยนแปลง',
    cancelLabel: 'อยู่หน้านี้ต่อ',
    danger: true,
  });
}

/** True when nothing is unsaved, or the person agrees to drop the edits. */
export function confirmLeaveIfDirty(): Promise<boolean> {
  if (!unsavedForms.size) return Promise.resolve(true);
  return askToLeave();
}

/**
 * Ask before leaving a form that has been edited.
 * Same-origin links (the sidebar included) and the modal close control use the same question.
 * Tab close and reload use the browser prompt.
 * ponytail: browser Back is not trapped. BrowserRouter has no blocker, and a fake history entry leaves the page when a save clears the form.
 */
export function useUnsavedChanges(dirty: boolean) {
  const formId = useRef(Symbol('unsaved-form'));
  useEffect(() => {
    const id = formId.current;
    if (!dirty) return;
    unsavedForms.add(id);
    const warn = (event: BeforeUnloadEvent) => {
      if (!unsavedForms.has(id)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const next = `${url.pathname}${url.search}${url.hash}`;
      if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      event.preventDefault();
      event.stopPropagation();
      void askToLeave().then((ok) => {
        if (!ok) return;
        unsavedForms.clear();
        window.location.assign(anchor.href);
      });
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', onClick, true);
      unsavedForms.delete(id);
    };
  }, [dirty]);
  return async function requestLeave(go: () => void) {
    if (await confirmLeaveIfDirty()) go();
  };
}

export function scrollToFirstInvalid(root: ParentNode | null | undefined) {
  const node = root?.querySelector('[aria-invalid="true"]');
  if (node instanceof HTMLElement) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Empty required field, after blur. The message names an example. */
export function blankFieldMessage(label: string, example?: string) {
  return formatUiMessage('กรอก{0} ตัวอย่าง: {1}', { 0: uiText(label), 1: example ? uiText(example) : '—' });
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

export type MasterOption = { value: string; label: string };

/** Case and extra spaces do not count as a different record. */
export function masterKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Same label, stored value, or a name beside a code, ignoring case and spaces. */
export function findMasterMatch(options: MasterOption[], query: string) {
  const key = masterKey(query);
  if (!key) return undefined;
  return options.find((option) => [option.label, option.value, ...option.label.split(/[·—|()]/)].some((part) => masterKey(part) === key));
}

export type MasterCreateField = {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  /** When set, the mini-form uses a dropdown instead of a text box. */
  options?: MasterOption[];
};

const masterInputCls = 'w-full min-h-10 px-3 py-2 bg-surface-container-lowest text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-[13px] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';

/**
 * Searchable master-data combobox. Create stays inside the parent form.
 * ponytail: filters the options it was given; server search when a list no longer fits one response.
 */
export function MasterDataSelect({
  options,
  value,
  onChange,
  multiple = false,
  placeholder = 'ค้นหาแล้วเลือก',
  canCreate = false,
  createFields,
  createFrom = 'name',
  onCreate,
  disabled,
  required = false,
  'aria-label': label,
  'aria-labelledby': labelledBy,
}: {
  options: MasterOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  /** False hides create and tells the person to ask an admin. */
  canCreate?: boolean;
  createFields?: MasterCreateField[];
  /** Mini-form field that receives the text they typed. */
  createFrom?: string;
  onCreate?: (draft: Record<string, string>) => Promise<MasterOption>;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const locale = useUiLocale();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [extra, setExtra] = useState<MasterOption[]>([]);
  const [creating, setCreating] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  const all = [...options, ...extra.filter((item) => !options.some((option) => option.value === item.value))];
  const byValue = new Map(all.map((option) => [option.value, option]));
  const needle = masterKey(query);
  const shown = needle ? all.filter((option) => masterKey(option.label).includes(needle) || masterKey(option.value).includes(needle)) : all;
  const exact = findMasterMatch(all, query);
  const offerCreate = canCreate && !!onCreate && !!needle && !exact;
  const offerBlankCreate = canCreate && !!onCreate && !offerCreate;
  const rows = shown.length + (offerCreate || offerBlankCreate ? 1 : 0);

  useEffect(() => {
    // Search text is not a selected record. Keep native form validation tied
    // to the stored value even while someone types an unmatched query.
    input.current?.setCustomValidity(required && !disabled && !selected.size ? uiText('ค้นหาแล้วเลือก') : '');
  }, [required, disabled, selected.size, locale]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const dialogOpen = creating !== null;
  useEffect(() => {
    const node = dialog.current;
    if (!dialogOpen || !node) return;
    node.showModal();
    return () => { node.close(); };
  }, [dialogOpen]);

  function change(next: string | string[]) {
    onChange(next);
    // Selecting a loaded option does not type into the input. Notify the form
    // so its existing unsaved-changes guard also protects mouse selections.
    box.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function choose(option: MasterOption) {
    if (multiple) {
      const next = selected.has(option.value) ? [...selected].filter((item) => item !== option.value) : [...selected, option.value];
      change(next);
      setQuery('');
      return;
    }
    change(option.value);
    setQuery('');
    setOpen(false);
  }

  function openCreate() {
    const fields = createFields?.length ? createFields : [{ name: createFrom, label: 'ชื่อรายการ', required: true }];
    const draft: Record<string, string> = {};
    for (const field of fields) draft[field.name] = field.name === createFrom ? query.trim() : '';
    setCreateError('');
    setCreating(draft);
    setOpen(false);
  }

  async function saveCreate() {
    if (!creating || !onCreate) return;
    const requiredMissing = (createFields?.length ? createFields : [{ name: createFrom, label: 'ชื่อรายการ', required: true }]).some((field) => field.required && !creating[field.name]?.trim());
    if (requiredMissing) return;
    const typed = creating[createFrom] ?? '';
    const duplicate = findMasterMatch(all, typed);
    if (duplicate) {
      choose(duplicate);
      setCreating(null);
      return;
    }
    setSaving(true);
    setCreateError('');
    try {
      const made = await onCreate(creating);
      const again = findMasterMatch(all, made.label) ?? findMasterMatch(all, made.value);
      const option = again ?? made;
      if (!again) setExtra((items) => [...items, made]);
      if (multiple) change([...selected, option.value]);
      else change(option.value);
      setQuery('');
      setCreating(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const fields = createFields?.length ? createFields : [{ name: createFrom, label: 'ชื่อรายการ', required: true }];
  const singleLabel = !multiple && !query ? byValue.get(String(value))?.label ?? '' : '';

  return (
    <div ref={box} className="relative min-w-0">
      {multiple && selected.size > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {[...selected].map((item) => (
            <button key={item} type="button" className="rounded-full bg-surface-container-low px-2 py-0.5 text-xs text-on-surface" onClick={() => choose({ value: item, label: byValue.get(item)?.label ?? item })} disabled={disabled}>
              {byValue.get(item)?.label ?? item} ×
            </button>
          ))}
        </div>
      )}
      <input
        ref={input}
        type="text"
        required={required}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label}
        aria-labelledby={labelledBy}
        className={masterInputCls}
        disabled={disabled}
        placeholder={uiText(placeholder)}
        value={open || multiple ? query : singleLabel}
        onFocus={() => { setOpen(true); setActive(0); }}
        onClick={() => { setOpen(true); setActive(0); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, Math.max(rows - 1, 0))); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          if (event.key === 'Escape') { setOpen(false); setQuery(''); }
          if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (exact) choose(exact);
            else if ((offerCreate || offerBlankCreate) && active >= shown.length) openCreate();
            else if (shown[active]) choose(shown[active]);
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-secondary-container bg-surface-container-lowest py-1 shadow-lg">
          {shown.map((option, index) => (
            <li key={option.value} role="option" aria-selected={selected.has(option.value)} className={cx('cursor-pointer px-3 py-2 text-sm text-on-surface', index === active && 'bg-surface-container-low')} onMouseDown={(event) => { event.preventDefault(); choose(option); }}>
              {option.label}
            </li>
          ))}
          {offerCreate && (
            <li role="option" aria-selected={false} className={cx('cursor-pointer px-3 py-2 text-sm font-medium text-primary', active >= shown.length && 'bg-surface-container-low')} onMouseDown={(event) => { event.preventDefault(); openCreate(); }}>
              {uiText('สร้าง "{0}"', { 0: query.trim() })}
            </li>
          )}
          {!shown.length && !offerCreate && (
            <li className="px-3 py-2 text-sm text-on-surface-variant">{uiText(needle && !canCreate ? 'ขอให้ผู้ดูแลเพิ่มรายการนี้' : 'ไม่พบในรายการ')}</li>
          )}
          {offerBlankCreate && (
            <li role="option" aria-selected={false} className={cx('cursor-pointer px-3 py-2 text-sm font-medium text-primary', active >= shown.length && 'bg-surface-container-low')} onMouseDown={(event) => { event.preventDefault(); openCreate(); }}>{uiText('+ สร้างใหม่')}</li>
          )}
        </ul>
      )}
      {creating && createPortal(
        <dialog ref={dialog} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-secondary-container bg-surface-container-lowest p-0 shadow-xl backdrop:bg-inverse-surface/40" onCancel={(event) => { event.preventDefault(); if (!saving) setCreating(null); }}>
          <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void saveCreate(); }}>
            <div className="space-y-3 px-4 py-4">
              <h2 className="text-base font-semibold text-on-surface">{uiText('+ สร้างใหม่')}</h2>
              {fields.map((field) => (
                <label key={field.name} className="flex flex-col gap-1 text-sm text-on-surface">
                  <span>{uiText(field.label)}{field.required ? ' *' : ''}</span>
                  {field.options ? (
                    <select className={masterInputCls} value={creating[field.name] ?? ''} onChange={(event) => setCreating({ ...creating, [field.name]: event.target.value })}>
                      <option value="">{uiText('ค้นหาแล้วเลือก')}</option>
                      {field.options.map((option) => <option key={option.value || 'none'} value={option.value}>{uiText(option.label)}</option>)}
                    </select>
                  ) : (
                    <input className={masterInputCls} value={creating[field.name] ?? ''} placeholder={field.placeholder ? uiText(field.placeholder) : undefined} onChange={(event) => setCreating({ ...creating, [field.name]: event.target.value })} />
                  )}
                </label>
              ))}
              {createError && <p className="text-sm text-[#c2333f]">{uiText(createError)}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-secondary-container px-4 py-3">
              <button type="button" className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm text-on-surface" disabled={saving} onClick={() => setCreating(null)}>{uiText('ยกเลิก')}</button>
              <button type="submit" className="inline-flex min-h-10 items-center rounded-lg bg-primary px-3 text-sm font-medium text-on-primary disabled:opacity-60" disabled={saving || fields.some((field) => field.required && !creating[field.name]?.trim())}>{saving ? uiText('กำลังบันทึก...') : uiText('บันทึกรายการใหม่')}</button>
            </div>
          </form>
        </dialog>,
        document.body,
      )}
    </div>
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

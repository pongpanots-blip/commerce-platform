/**
 * Shared workspace UI for commerce-admin and commerce-portal. The original Stitch exports
 * remain design references; the current usability system is documented in
 * docs/design/workspace-redesign.md and applied here across every category.
 */
import {
  ButtonHTMLAttributes,
  FormEvent,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  createContext,
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useContext,
  useId,
  useRef,
  useState,
} from 'react';
import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { ICONS } from './icons';
import { LanguageSelector } from './i18n';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, getUiLocale, hasUiText } from "./i18n";
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- icons

/** Local SVG icons remain legible when external fonts are unavailable. */
export function Icon({ name, size, className }: { name: string; size?: number; className?: string }) {
  const Glyph = ICONS[name] ?? ICONS.circle;
  return <Glyph size={size ?? 18} className={cx('shrink-0', className)} aria-hidden="true" focusable="false" />;
}

// ---------------------------------------------------------------- tones

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'primary';

const CHIP: Record<Tone, string> = {
  ok: 'bg-[#e7f5ec] text-[#157347]',
  info: 'bg-[#e9f2ff] text-[#2044c5]',
  warn: 'bg-[#fef7e0] text-[#b08900]',
  danger: 'bg-[#fdecee] text-[#c2333f]',
  muted: 'bg-surface-container text-secondary',
  primary: 'bg-primary-container text-on-primary-container',
};
const DOT: Record<Tone, string> = {
  ok: 'bg-[#157347]',
  info: 'bg-[#2044c5]',
  warn: 'bg-[#b08900]',
  danger: 'bg-[#c2333f]',
  muted: 'bg-outline-variant',
  primary: 'bg-primary',
};
const TEXT: Record<Tone, string> = {
  ok: 'text-[#157347]',
  info: 'text-[#2044c5]',
  warn: 'text-[#b08900]',
  danger: 'text-[#c2333f]',
  muted: 'text-on-surface-variant',
  primary: 'text-primary',
};

/** Map a backend status string to a tone (same buckets the old statusBadgeClass used). */
export function toneOf(status: string | null | undefined): Tone {
  const s = (status ?? '').toLowerCase();
  if (/(fail|error|invalid|reject|dead|cancel|revoked|expired|overdue|block)/.test(s)) return 'danger';
  if (/(unpaid|pend|wait|queue|retry|hold|draft|review|partial|stale|running|processing)/.test(s)) return 'warn';
  if (/(inactive|disabled|paused|archived|none|skipped)/.test(s)) return 'muted';
  if (/(ok|success|succeed|paid|active|valid|applied|done|complete|confirm|deliver|ship|synced|approved|enabled|live|ready)/.test(s)) return 'ok';
  return 'info';
}

export function Chip({ tone = 'muted', children, className, statusCode }: { tone?: Tone; children: ReactNode; className?: string; statusCode?: string | null }) {
  return (
    <span data-status={statusCode ?? undefined} className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', CHIP[tone], className)}>
      {children}
    </span>
  );
}

/** A status chip whose tone comes from the status text. */
export function StatusChip({ status }: { status: string | null | undefined }) {
  __useUiLocale();
  return <Chip tone={toneOf(status)} statusCode={status}>{statusLabel(status)}</Chip>;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active', inactive: 'Inactive', enabled: 'Enabled', disabled: 'Disabled',
  pending: 'Pending', queued: 'Queued', running: 'Running', processing: 'Processing',
  success: 'Success', succeeded: 'Succeeded', completed: 'Completed', complete: 'Completed',
  failed: 'Failed', error: 'Error', cancelled: 'Cancelled', canceled: 'Cancelled',
  draft: 'Draft', paused: 'Paused', paid: 'Paid', unpaid: 'Unpaid', shipped: 'Shipped',
  delivered: 'Delivered', approved: 'Approved', rejected: 'Rejected', revoked: 'Revoked',
  expired: 'Expired', reserved: 'Reserved', released: 'Released', confirmed: 'Confirmed',
};

/** Labels are translated for display; filter values and request enums stay unchanged. */
export function statusLabel(status: string | null | undefined) {
  if (!status) return '—';
  const label = STATUS_LABELS[status.toLowerCase()];
  return label ? __uiText(label) : status;
}

export function StatusDot({ tone, children }: { tone: Tone; children?: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[11px]', TEXT[tone])}>
      <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', DOT[tone])} />
      {children}
    </span>
  );
}

/** Small mono count pill (nav counts, tab counts). */
export function Count({ children, tone }: { children: ReactNode; tone?: 'danger' }) {
  return (
    <span
      className={cx(
        'text-[10px] font-mono px-1.5 py-0.5 rounded',
        tone === 'danger' ? 'bg-error-container text-on-error-container font-semibold' : 'text-outline bg-surface-container',
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- buttons & inputs

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-dim border border-primary shadow-xs',
  secondary: 'border border-secondary-container bg-surface-container-lowest hover:bg-surface-container-low text-on-surface',
  ghost: 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border border-transparent',
  danger: 'bg-[#c2333f] text-white hover:bg-[#a82b36] border border-[#c2333f]',
  'danger-ghost': 'text-[#c2333f] hover:bg-[#fdecee] border border-transparent',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; icon?: string }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1',
        size === 'sm' ? 'min-h-8 px-2.5 py-1 text-xs' : 'min-h-10 px-3.5 py-2 text-[13px]',
        BTN[variant],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} className={variant === 'secondary' ? 'text-outline' : undefined} />}
      {children}
    </button>
  );
}

/** Router link styled as a button. */
export function ButtonLink({ to, variant = 'secondary', icon, children, className }: { to: string; variant?: BtnVariant; icon?: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cx('inline-flex min-h-10 items-center gap-2 rounded-lg font-medium transition-colors px-3.5 py-2 text-[13px] whitespace-nowrap', BTN[variant], className)}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </Link>
  );
}

/** Text link with trailing arrow ("Manage →", "View all jobs →"). */
export function ArrowLink({ to, children, tone = 'primary' }: { to: string; children: ReactNode; tone?: Tone }) {
  return (
    <Link to={to} className={cx('text-xs font-medium hover:underline inline-flex items-center gap-0.5', TEXT[tone])}>
      <span>{children}</span>
      <Icon name="arrow_forward" size={14} />
    </Link>
  );
}

export const inputCls =
  'w-full min-h-10 px-3 py-2 bg-surface-container-lowest text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-[13px] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-colors disabled:opacity-60';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputCls, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, 'pr-7 bg-surface-container-lowest', className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, 'font-mono text-[11px] leading-relaxed', className)} {...rest} />;
}

/** Search box with leading magnifier icon. */
export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx('relative', className)}>
      <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
      <input type="search" className={cx(inputCls, 'pl-8')} {...rest} />
    </div>
  );
}

/** Labelled form field. */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  __useUiLocale();
  const labelId = useId();
  const hintId = useId();
  const controls = Children.map(children, (child, index) => {
    if (index !== 0 || !isValidElement<{ 'aria-labelledby'?: string; 'aria-describedby'?: string; 'aria-label'?: string }>(child)) return child;
    return cloneElement(child, {
      ...(label && !child.props['aria-label'] && !child.props['aria-labelledby'] ? { 'aria-labelledby': labelId } : {}),
      ...(hint ? { 'aria-describedby': [child.props['aria-describedby'], hintId].filter(Boolean).join(' ') } : {}),
    });
  });
  return (
    <label className={cx('flex flex-col gap-1 min-w-0', className)}>
      <span id={labelId} className="text-xs font-medium text-on-surface">{typeof label === 'string' ? __uiText(label) : label}</span>
      {controls}
      {hint && <span id={hintId} className="text-[11px] text-outline">{typeof hint === 'string' ? __uiText(hint) : hint}</span>}
    </label>
  );
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  __useUiLocale();
  const box = <input type="checkbox" className="rounded border-secondary accent-primary w-3.5 h-3.5" {...rest} />;
  if (!label) return box;
  return (
    <label className={cx('inline-flex items-center gap-1.5 text-xs text-on-surface cursor-pointer', className)}>
      {box}
      {typeof label === 'string' ? __uiText(label) : label}
    </label>
  );
}

/** Toggleable pill (event subscriptions, source pickers). */
export function TogglePill({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] border transition-colors',
        on ? 'bg-primary-container border-primary/30 text-on-primary-container' : 'bg-surface-container-lowest border-secondary-container text-on-surface-variant hover:bg-surface-container-low',
      )}
    >
      {on && <Icon name="check" size={12} />}
      {children}
    </button>
  );
}

/** Segmented control (status filters, tabs). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('flex items-center bg-surface-container-low p-0.5 rounded-lg border border-secondary-container', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex-1 py-1 px-2.5 text-center rounded-md text-xs transition-all whitespace-nowrap inline-flex items-center justify-center gap-1.5',
              on ? 'bg-surface-container-lowest font-semibold text-primary shadow-xs' : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="font-mono text-[10px] text-outline">{o.count.toLocaleString()}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Removable active-filter chip. */
export function FilterChip({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  __useUiLocale();
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container border border-secondary-container text-on-surface text-[11px]">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-outline hover:text-error" aria-label={__uiText("ลบตัวกรอง")}>
          <Icon name="close" size={13} />
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- layout

export const panelCls = 'min-w-0 bg-surface-container-lowest rounded-xl border border-secondary-container shadow-[0_2px_5px_rgba(23,36,59,0.025)]';

export function Panel({ children, className, as = 'section', onSubmit }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'form'; onSubmit?: (e: FormEvent<HTMLFormElement>) => unknown }) {
  if (as === 'form') return <form data-panel className={cx(panelCls, className)} onSubmit={onSubmit}>{children}</form>;
  const As = as;
  return <As data-panel className={cx(panelCls, className)}>{children}</As>;
}

/** Panel title bar: title (+ optional icon / badge) left, actions right. */
export function PanelHead({ title, icon, badge, sub, actions }: { title: ReactNode; icon?: string; badge?: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-secondary-container">
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <span className="w-7 h-7 rounded-md bg-surface-container-low text-primary flex items-center justify-center shrink-0">
            <Icon name={icon} size={16} />
          </span>
        )}
        <h2 className="text-sm font-semibold text-on-surface truncate">{title}</h2>
        {badge}
        {sub && <span className="text-[11px] text-on-surface-variant">{sub}</span>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Page title block: breadcrumb, H1 (+badge), subtitle, right-hand actions. */
export function PageHeader({
  crumbs: crumbsProp,
  back,
  title,
  badge,
  subtitle,
  actions,
}: {
  crumbs?: string[];
  /** Detail pages: link back to the list they came from. */
  back?: { to: string; label: string };
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  __useUiLocale();
  const derived = useNavCrumbs();
  const crumbs = crumbsProp ?? derived;
  return (
    <section className="space-y-1.5">
      {crumbs && crumbs.length > 0 && (
        <nav className="flex items-center gap-1.5 text-xs text-on-surface-variant font-medium" aria-label={__uiText("breadcrumb")}>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-outline-variant">/</span>}
              <span className={i === crumbs.length - 1 ? 'text-on-surface font-semibold' : undefined}>{c}</span>
            </span>
          ))}
        </nav>
      )}
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Icon name="arrow_back" size={14} />
          {__uiText(back.label)}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl md:text-[28px] font-semibold tracking-tight text-on-surface font-headline break-words [overflow-wrap:anywhere]">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="text-sm text-on-surface-variant mt-2 max-w-3xl leading-relaxed">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  );
}

/** Small outlined pill next to a page title ("อ่านอย่างเดียว · ข้อมูลจาก josh"). */
export function TitleBadge({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-surface-container text-on-surface-variant border border-secondary-container">
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/** Upper-case section heading with optional right note. */
export function SectionTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  __useUiLocale();
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{typeof children === 'string' ? __uiText(children) : children}</h2>
      {note && <span className="text-[11px] text-outline">{typeof note === 'string' ? __uiText(note) : note}</span>}
    </div>
  );
}

/** The standard page body width + vertical rhythm. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="max-w-[1240px] mx-auto space-y-4">{children}</div>;
}

// ---------------------------------------------------------------- create / edit forms and detail views

/**
 * Create / edit form as a panel: icon + title + optional description in the head, fields in a
 * responsive grid (`cols`), Cancel / Submit right-aligned in the footer. Use for every
 * "+ New …" / "แก้ไข" form, inline or standalone.
 */
export function FormPanel({
  title,
  icon = 'add_circle',
  description,
  cols = 2,
  children,
  error,
  submitLabel = 'บันทึก',
  busy,
  onSubmit,
  onCancel,
  extraActions,
}: {
  title: ReactNode;
  icon?: string;
  description?: ReactNode;
  cols?: 1 | 2 | 3 | 4;
  children: ReactNode;
  error?: string | null;
  submitLabel?: ReactNode;
  busy?: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => unknown;
  onCancel?: () => void;
  extraActions?: ReactNode;
}) {
  __useUiLocale();
  const grid = { 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' }[cols];
  return (
    <form data-panel
      className={cx(panelCls, 'overflow-hidden')}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(e);
      }}
    >
      <div className="flex items-start gap-3 px-4 py-3 border-b border-secondary-container">
        <span className="w-7 h-7 rounded-md bg-primary-container text-primary flex items-center justify-center shrink-0">
          <Icon name={icon} size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-on-surface">{title}</h2>
          {description && <p className="text-[11px] text-on-surface-variant mt-0.5">{description}</p>}
        </div>
      </div>
      <div className={cx('grid grid-cols-1 gap-3 p-4', grid)}>{children}</div>
      {error && (
        <div className="px-4 pb-3">
          <Alert tone="danger">{__uiText(error)}</Alert>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-secondary-container bg-surface-container-low/50">
        {extraActions}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {__uiText("ยกเลิก")}</Button>
        )}
        <Button variant="primary" type="submit" icon={busy ? 'progress_activity' : 'check'} disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Full-width cell inside a FormPanel / KeyValueGrid grid. */
export function Span({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('col-span-full', className)}>{children}</div>;
}

/** Detail facts: label above value, in a responsive grid. Values may be any node (chips, mono, links). */
export function KeyValueGrid({ items, cols = 4 }: { items: { label: ReactNode; value: ReactNode; mono?: boolean; wide?: boolean }[]; cols?: 2 | 3 | 4 }) {
  __useUiLocale();
  const grid = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
  return (
    <dl className={cx('grid grid-cols-1 gap-x-6 gap-y-3', grid)}>
      {items.map((it, i) => (
        <div key={i} className={cx('min-w-0', it.wide && 'col-span-full')}>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-outline">{typeof it.label === 'string' ? __uiText(it.label) : it.label}</dt>
          <dd className={cx('mt-0.5 text-xs text-on-surface break-words', it.mono && 'font-mono text-[11px]')}>{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Titled block inside a detail view (ExpandRow or detail Panel): small heading + optional actions + content. */
export function DetailSection({ title, icon, actions, children }: { title: ReactNode; icon?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {icon && <Icon name={icon} size={15} className="text-outline" />}
          {title}
        </h3>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A detail view as its own panel (when a page shows one record below/next to a list). */
export function DetailPanel({ title, subtitle, status, actions, onClose, children }: { title: ReactNode; subtitle?: ReactNode; status?: ReactNode; actions?: ReactNode; onClose?: () => void; children: ReactNode }) {
  __useUiLocale();
  return (
    <section data-panel className={cx(panelCls, 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-secondary-container">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-on-surface">{title}</h2>
            {status}
          </div>
          {subtitle && <p className="text-[11px] text-on-surface-variant font-mono mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {onClose && <IconButton icon="close" title={__uiText("ปิด")} onClick={onClose} />}
        </div>
      </div>
      <div className="p-4 space-y-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- feedback

const ALERT: Record<Tone, { box: string; icon: string }> = {
  ok: { box: 'bg-[#f0f9f4] border-[#d1e7dd] text-[#0f5132]', icon: 'check_circle' },
  warn: { box: 'bg-[#fef7e0] border-[#f5e2a8] text-[#7a5d00]', icon: 'warning' },
  danger: { box: 'bg-[#fdecee] border-[#f5c2c7] text-[#842029]', icon: 'error' },
  info: { box: 'bg-[#e9f2ff] border-[#c9dcff] text-[#1e43c5]', icon: 'info' },
  muted: { box: 'bg-surface-container-low border-secondary-container text-on-surface-variant', icon: 'info' },
  primary: { box: 'bg-primary-container border-primary/20 text-on-primary-container', icon: 'info' },
};

export function Alert({ tone = 'info', title, children, onClose, actions }: { tone?: Tone; title?: ReactNode; children?: ReactNode; onClose?: () => void; actions?: ReactNode }) {
  __useUiLocale();
  const a = ALERT[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex items-start gap-3 rounded-lg border px-4 py-3 text-xs', a.box)}>
      <Icon name={a.icon} size={18} className="mt-px" />
      <div className="flex-1 min-w-0 space-y-0.5">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="leading-relaxed break-words">{children}</div>}
      </div>
      {actions}
      {onClose && (
        <button type="button" onClick={onClose} aria-label={__uiText("ปิด")} className="opacity-70 hover:opacity-100">
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

/** Inline error line (load failures). Renders nothing when there is no error. */
export function ErrorText({ error }: { error: string | null | undefined }) {
  __useUiLocale();
  if (!error) return null;
  const known = hasUiText(error);
  return <Alert tone="danger">
    <p>{known ? __uiText(error) : __uiText('โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง')}</p>
    {!known && <details className="mt-3">
      <summary className="cursor-pointer">{__uiText('รายละเอียดข้อผิดพลาด')}</summary>
      <p className="mt-2 break-words">{error}</p>
    </details>}
  </Alert>;
}

export function Empty({ children = 'ไม่มีข้อมูล', icon = 'inbox' }: { children?: ReactNode; icon?: string }) {
  __useUiLocale();
  return (
    <div className="py-10 flex flex-col items-center gap-2 text-on-surface-variant text-xs">
      <Icon name={icon} size={28} className="text-outline-variant" />
      <div>{typeof children === 'string' ? __uiText(children) : children}</div>
    </div>
  );
}

export function Loading({ children = 'กำลังโหลด…' }: { children?: ReactNode }) {
  __useUiLocale();
  return (
    <div className="py-10 flex items-center justify-center gap-2 text-on-surface-variant text-xs">
      <Icon name="progress_activity" size={18} className="animate-spin text-primary" />
      {typeof children === 'string' ? __uiText(children) : children}
    </div>
  );
}

/** Muted helper text. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  __useUiLocale();
  return <p className={cx('text-[11px] text-on-surface-variant', className)}>{typeof children === 'string' ? __uiText(children) : children}</p>;
}

// ---------------------------------------------------------------- stats

/** KPI tile. Clickable when `to` / `onClick` is set; `selected` for tiles used as filters. */
export function StatTile({
  label,
  value,
  icon,
  tone,
  foot,
  to,
  onClick,
  selected,
  accent,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: string;
  tone?: Tone;
  foot?: ReactNode;
  to?: string;
  onClick?: () => void;
  selected?: boolean;
  /** Coloured left border + coloured value (the "Needs attention" cards). */
  accent?: boolean;
  className?: string;
}) {
  const accentBorder = accent && tone ? { warn: 'border-l-4 border-l-amber-500', danger: 'border-l-4 border-l-rose-500', ok: 'border-l-4 border-l-emerald-600', info: 'border-l-4 border-l-primary', muted: '', primary: 'border-l-4 border-l-primary' }[tone] : '';
  const valueColor = accent && tone ? { warn: 'text-amber-700', danger: 'text-rose-700', ok: 'text-on-surface', info: 'text-on-surface', muted: 'text-on-surface', primary: 'text-primary' }[tone] : tone === 'danger' ? 'text-[#c2333f]' : tone === 'warn' ? 'text-[#b08900]' : 'text-on-surface';
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-on-surface-variant truncate">{label}</p>
          <p className={cx('font-semibold mt-1 tabular-nums', accent ? 'text-2xl md:text-3xl' : 'text-xl', valueColor)}>{value}</p>
        </div>
        {icon && (
          <span className={cx('p-1 rounded', accent && tone ? { warn: 'bg-amber-50 text-amber-600', danger: 'bg-rose-50 text-rose-600', ok: 'bg-emerald-50 text-emerald-600', info: 'bg-primary-container text-primary', muted: 'bg-surface-container text-outline', primary: 'bg-primary-container text-primary' }[tone] : 'text-outline')}>
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
      {foot && <div className={cx('text-[11px] text-outline', accent ? 'mt-4 pt-2 border-t border-secondary-container/70 flex items-center justify-between' : 'mt-2')}>{foot}</div>}
    </>
  );
  const cls = cx(
    'block text-left rounded-lg p-4 border shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors',
    selected ? 'bg-primary-container/40 border-primary ring-1 ring-primary' : 'bg-surface-container-lowest border-secondary-container',
    (to || onClick) && !selected && 'hover:border-outline-variant',
    accentBorder,
    className,
  );
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" aria-pressed={selected} onClick={onClick} className={cx(cls, 'w-full')}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: number }) {
  const n = Math.min(6, Math.max(2, Math.round(cols))) as 2 | 3 | 4 | 5 | 6;
  const c = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4', 5: 'md:grid-cols-3 lg:grid-cols-5', 6: 'md:grid-cols-3 lg:grid-cols-6' }[n];
  return <div className={cx('grid grid-cols-1 gap-4', c)}>{children}</div>;
}

/** Signed % change ("▲ 12.4%"). */
export function Delta({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums', up ? 'text-[#157347]' : 'text-[#c2333f]')}>
      <Icon name={up ? 'trending_up' : 'trending_down'} size={14} />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ---------------------------------------------------------------- tables

/** Scrollable table shell with Stitch styling; children are <thead>/<tbody>. */
export function Table({ children, maxHeight, className }: { children: ReactNode; maxHeight?: string; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', maxHeight && 'overflow-y-auto', className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface-container-low/95 backdrop-blur-xs border-b border-secondary-container text-on-surface-variant font-semibold select-none">
      <tr className="h-11">{children}</tr>
    </thead>
  );
}

export function TH({ children, right, kind, className }: { children?: ReactNode; right?: boolean; kind?: TdKind; className?: string }) {
  __useUiLocale();
  const alignRight = right || kind === 'num' || kind === 'money' || kind === 'actions';
  return <th className={cx('px-3 font-semibold whitespace-nowrap', alignRight && 'text-right', className)}>{typeof children === 'string' ? __uiText(children) : children}</th>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-secondary-container/70 text-on-surface">{children}</tbody>;
}

export function TR({ children, onClick, selected, muted, className }: { children: ReactNode; onClick?: () => void; selected?: boolean; muted?: boolean; className?: string }) {
  return (
    <tr
      onClick={onClick}
      className={cx(
        'h-12 transition-colors duration-100',
        selected ? 'bg-primary-container/30' : 'hover:bg-surface-container-low',
        muted && 'opacity-60',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </tr>
  );
}

type TdKind = 'text' | 'mono' | 'code' | 'num' | 'money' | 'link' | 'muted' | 'time' | 'actions';
const TD_CLS: Record<TdKind, string> = {
  text: '',
  mono: 'font-mono text-[11px]',
  code: 'font-mono text-[11px]',
  num: 'text-right font-mono tabular-nums',
  money: 'text-right font-mono font-semibold tabular-nums whitespace-nowrap',
  link: 'font-mono font-semibold text-primary',
  muted: 'text-on-surface-variant',
  time: 'text-on-surface-variant font-mono whitespace-nowrap text-[11px]',
  actions: 'text-right whitespace-nowrap',
};

export function TD({ children, kind = 'text', className, colSpan, title }: { children?: ReactNode; kind?: TdKind; className?: string; colSpan?: number; title?: string }) {
  return (
    <td colSpan={colSpan} title={title} className={cx('px-3 py-2.5', TD_CLS[kind], className)}>
      {children}
    </td>
  );
}

/** The record's identifier in a list row: a real link to its detail page (works with ctrl/cmd-click and
 *  the keyboard) that doesn't also fire the row's own click handler. */
export function RowLink({ to, state, mono = true, children }: { to: string; state?: unknown; mono?: boolean; children: ReactNode }) {
  return (
    <Link
      to={to}
      state={state}
      onClick={(e) => e.stopPropagation()}
      className={cx('text-primary hover:underline', mono ? 'font-mono font-semibold' : 'font-medium')}
    >
      {children}
    </Link>
  );
}

/** Two-line cell: bold primary + muted secondary. */
export function Stack2({ top, bottom, maxW = 230 }: { top: ReactNode; bottom?: ReactNode; maxW?: number }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-on-surface truncate" style={{ maxWidth: maxW }}>{top}</div>
      {bottom && <div className="text-[10px] text-on-surface-variant truncate" style={{ maxWidth: maxW }}>{bottom}</div>}
    </div>
  );
}

/** Full-width expanded row below a table row. */
export function ExpandRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className="bg-surface-container-low/60">
      <td colSpan={colSpan} className="px-4 py-4 border-t border-secondary-container">
        <div className="space-y-3">{children}</div>
      </td>
    </tr>
  );
}

/** Chevron toggle for expandable rows. */
export function ExpandToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline">
      {label}
      <Icon name={open ? 'expand_less' : 'expand_more'} size={16} />
    </button>
  );
}

/** Empty / loading row spanning the table. */
export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}

// ---------------------------------------------------------------- pager

function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, 2, page - 1, page, page + 1, pages - 1, pages].filter((p) => p >= 1 && p <= pages));
  const out: (number | '…')[] = [];
  let prev = 0;
  for (const p of [...set].sort((a, b) => a - b)) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

/** Table footer: "แสดง a–b จาก n รายการ" + page size + numbered pages. `page` is 1-based. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  sizes = [20, 50, 100],
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
  sizes?: number[];
}) {
  __useUiLocale();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const nav = 'w-7 h-7 flex items-center justify-center rounded border border-secondary-container hover:bg-surface-container-low disabled:opacity-40 disabled:pointer-events-none transition-colors';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-secondary-container text-xs text-on-surface-variant">
      <div>
        {__uiText("แสดง ")}<span className="font-mono text-on-surface font-semibold tabular-nums">{from.toLocaleString()}–{to.toLocaleString()}</span> {__uiText(" จาก")}{' '}
        <span className="font-mono text-on-surface font-semibold tabular-nums">{total.toLocaleString()}</span> {__uiText(" รายการ")}</div>
      <div className="flex items-center gap-4">
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            <span className="text-[11px]">{__uiText("แถวต่อหน้า:")}</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="py-1 pl-2 pr-6 bg-surface-container-low border border-secondary-container rounded text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
            >
              {sizes.map((s) => (
                <option key={s} value={s}>{s} {__uiText(" / หน้า")}</option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-1 font-mono">
          <button type="button" className={nav} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={__uiText("ก่อนหน้า")}>
            <Icon name="chevron_left" size={15} />
          </button>
          {pageList(page, pages).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="px-1 text-outline">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPage(p)}
                aria-current={p === page ? 'page' : undefined}
                className={cx(
                  'w-7 h-7 flex items-center justify-center rounded text-xs transition-colors',
                  p === page ? 'bg-primary text-on-primary font-semibold' : 'hover:bg-surface-container-low text-on-surface font-medium',
                )}
              >
                {p}
              </button>
            ),
          )}
          <button type="button" className={nav} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={__uiText("ถัดไป")}>
            <Icon name="chevron_right" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- code

/** JSON / text block with title and copy button. */
export function CodeBlock({ title, value, maxHeight = 320 }: { title?: ReactNode; value: unknown; maxHeight?: number }) {
  __useUiLocale();
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-secondary-container bg-surface-container-low overflow-hidden min-w-0">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-secondary-container text-[10px] font-mono uppercase tracking-wide text-on-surface-variant">
        <span>{title ?? __uiText("payload")}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 normal-case hover:text-primary"
          onClick={() => {
            navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }).catch(() => undefined);
          }}
        >
          <Icon name={copied ? 'check' : 'content_copy'} size={13} />
          {copied ? __uiText("Copied") : __uiText("Copy")}
        </button>
      </div>
      <pre className="p-3 text-[11px] leading-relaxed font-mono text-on-surface overflow-auto whitespace-pre-wrap break-all" style={{ maxHeight }}>
        {text}
      </pre>
    </div>
  );
}

/** Inline monospace value with a copy button (keys, URLs). */
export function CopyValue({ value, className }: { value: string; className?: string }) {
  __useUiLocale();
  const [copied, setCopied] = useState(false);
  return (
    <span className={cx('inline-flex items-center gap-1.5 min-w-0', className)}>
      <code className="font-mono text-[11px] bg-surface-container-low border border-secondary-container rounded px-2 py-0.5 truncate">{value}</code>
      <button
        type="button"
        title={__uiText("Copy")}
        className="text-outline hover:text-primary shrink-0"
        onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => undefined)}
      >
        <Icon name={copied ? 'check' : 'content_copy'} size={14} />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------- charts (no chart lib: plain divs, as before)

/** Horizontal bar list: label · bar · value text. */
export function BarList({ rows, tone = 'primary' }: { rows: { label: ReactNode; value: number; text?: ReactNode }[]; tone?: 'primary' | 'danger' }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5 px-4 py-3">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(80px,160px)_1fr_auto] items-center gap-3 text-xs">
          <span className="truncate text-on-surface-variant">{r.label}</span>
          <div className="h-2 rounded-full bg-surface-container-low overflow-hidden">
            <div className={cx('h-full rounded-full', tone === 'danger' ? 'bg-[#c2333f]' : 'bg-primary')} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="font-mono tabular-nums text-on-surface text-right">{r.text ?? r.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical stacked bars (ok / error) with hover titles. */
export function StackedBars({ bars, height = 120 }: { bars: { label: string; ok: number; err: number }[]; height?: number }) {
  __useUiLocale();
  const max = Math.max(1, ...bars.map((b) => b.ok + b.err));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end h-full min-w-[4px] group" title={__uiText("{0} · ok {1} · error {2}", {"0": b.label, "1": b.ok, "2": b.err})}>
            <div className="bg-[#c2333f] rounded-t-sm" style={{ height: `${(b.err / max) * 100}%` }} />
            <div className={cx('bg-primary group-hover:bg-primary-dim', b.err ? '' : 'rounded-t-sm')} style={{ height: `${(b.ok / max) * 100}%` }} />
          </div>
        ))}
      </div>
      {bars.length > 0 && (
        <div className="flex justify-between mt-1.5 text-[10px] font-mono text-outline">
          <span>{bars[0].label}</span>
          <span>{bars[Math.floor(bars.length / 2)].label}</span>
          <span>{bars[bars.length - 1].label}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- shell

const NavContext = createContext<NavGroup[]>([]);

/** Makes the app's nav available to PageHeader so every page gets the same "group / page" breadcrumb. */
export function NavProvider({ nav, children }: { nav: NavGroup[]; children: ReactNode }) {
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

export function useNavigation() { return useContext(NavContext); }

/** [group, page] for the current route, from the nav (undefined for top-level pages like Overview). */
function useNavCrumbs(): string[] | undefined {
  const nav = useContext(NavContext);
  const { pathname } = useLocation();
  const matches = nav.flatMap(group => group.links.map(link => ({ group, link })))
    .filter(({ link }) => matchPath({ path: link.to, end: link.end ?? false }, pathname) && (link.to !== '/' || pathname === '/'))
    .sort((a, b) => b.link.to.length - a.link.to.length);
  const hit = matches[0];
  if (hit) return hit.group.group ? [__uiText(hit.group.group), __uiText(hit.link.label)] : undefined;
  return undefined;
}

export type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  icon?: string;
  badge?: ReactNode;
  /** One line on what the page is for (UI copy): the item's tooltip and menu-search text. */
  description?: string;
  /** Sub-pages outside `to` (create / edit / detail) that highlight this item, e.g. '/j/coupon'. */
  activeFor?: string[];
  /** Less used: listed after the group's "show more" item (menu search still finds it). */
  more?: boolean;
};
export type NavGroup = { group?: string; icon?: string; links: NavItem[] };

const startsWithPath = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/** How specifically `item` covers `pathname` (0 = not at all); the longest match is the current page. */
export function navMatchLength(item: NavItem, pathname: string): number {
  if (item.to === '/') return pathname === '/' ? 1 : 0;
  if (matchPath({ path: item.to, end: item.end ?? false }, pathname)) return item.to.length;
  return Math.max(0, ...(item.activeFor ?? []).filter(prefix => startsWithPath(pathname, prefix)).map(prefix => prefix.length));
}

/** The nav item (and its group) for the current page, sub-pages included. */
export function currentNavItem(nav: NavGroup[], pathname: string): { group: NavGroup; link: NavItem } | undefined {
  let best: { group: NavGroup; link: NavItem } | undefined;
  let bestLength = 0;
  for (const group of nav) for (const link of group.links) {
    const length = navMatchLength(link, pathname);
    if (length > bestLength) { bestLength = length; best = { group, link }; }
  }
  return best;
}

/** Keyboard-accessible page search. Searches the permitted navigation, never business data. */
export function CommandMenu() {
  __useUiLocale();
  const nav = useNavigation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const resultsId = useId();
  const results = nav.flatMap(group => group.links.map(link => ({ ...link, group: group.group })))
    .filter(link => `${link.label} ${link.group ?? ''} ${__uiText(link.label)} ${link.group ? __uiText(link.group) : ''} ${link.description ? __uiText(link.description) : ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const close = () => setOpen(false);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setOpen(value => !value);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    if (open) { setQuery(''); setSelected(0); dialog.current?.showModal(); input.current?.focus(); }
    else if (dialog.current?.open) { dialog.current.close(); opener.current?.focus(); }
  }, [open]);
  useEffect(() => { document.getElementById(`${resultsId}-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [selected, resultsId]);
  function visit(index: number) { if (results[index]) { navigate(results[index].to); close(); } }
  return <>
    <button ref={opener} type="button" onClick={() => setOpen(true)} aria-label={__uiText("ค้นหาหน้าและเมนู")} className="flex min-h-10 items-center gap-2 rounded-lg border border-secondary-container bg-surface-container-low px-3 text-sm text-on-surface-variant hover:border-primary/40">
      <Icon name="search" size={18} /><span className="hidden sm:inline">{__uiText("ค้นหาหน้าและเมนู")}</span><kbd className="ml-4 hidden rounded border border-secondary-container bg-white px-1.5 py-0.5 text-[10px] sm:inline">{__uiText("⌘ / Ctrl K")}</kbd>
    </button>
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }} className="cp-command-dialog w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-secondary-container bg-white p-0 shadow-2xl backdrop:bg-inverse-surface/40">
      <div className="flex items-center justify-between px-5 pt-4"><h2 id={titleId} className="font-semibold">{__uiText("ไปยังหน้าที่ต้องการ")}</h2><IconButton icon="close" title={__uiText("ปิดการค้นหา")} onClick={close} /></div>
      <div className="px-5 pb-4 pt-3"><input ref={input} type="search" role="combobox" aria-label={__uiText("ค้นหาเมนูทั้งหมด")} aria-expanded={open} aria-controls={resultsId} aria-autocomplete="list" aria-activedescendant={results[selected] ? `${resultsId}-${selected}` : undefined} placeholder={__uiText("เช่น สินค้า ออเดอร์ หรือคิวงาน")} className={inputCls} value={query}
        onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => results.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0); }
          if (event.key === 'Enter') { event.preventDefault(); visit(selected); }
        }} /></div>
      <div id={resultsId} role="listbox" aria-label={__uiText("ผลการค้นหาเมนู")} className="max-h-[55vh] overflow-y-auto border-t border-secondary-container p-2">
        {results.length ? results.map((item, index) => <div key={item.to} id={`${resultsId}-${index}`} role="option" aria-selected={selected === index} className={cx('rounded-lg', selected === index && 'bg-primary-container/50')}>
          <button type="button" tabIndex={-1} onClick={() => visit(index)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left">
            <span><span className="block text-sm font-medium">{__uiText(item.label)}</span><span className="mt-0.5 block text-xs text-on-surface-variant">{item.group ? __uiText(item.group) : __uiText("หน้าหลัก")}{item.description ? ` · ${__uiText(item.description)}` : ''}</span></span><Icon name="arrow_forward" className="text-outline" />
          </button>
        </div>) : <Empty icon="search_off">{__uiText("ไม่พบเมนู ลองค้นหาด้วยคำอื่น")}</Empty>}
      </div>
      <p className="border-t border-secondary-container px-5 py-3 text-xs text-on-surface-variant">{__uiText("↑ ↓ เลือกเมนู · Enter เปิดหน้า · Esc ปิด")}</p>
    </dialog>
  </>;
}

/**
 * Left sidebar (256px, fixed). Groups with a title collapse; the group holding the current page
 * opens by default, user toggles win. A filter box narrows links by label.
 */
export function Sidebar({
  brand,
  env,
  nav,
  searchable,
  user,
  footer,
}: {
  brand: { title: string; subtitle?: string; icon?: string };
  env?: ReactNode;
  nav: NavGroup[];
  searchable?: boolean;
  user?: { name: string; detail?: string; onSignOut?: () => void };
  footer?: ReactNode;
}) {
  __useUiLocale();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);
  const navId = useId();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [showMore, setShowMore] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const activeDestination = currentNavItem(nav, pathname)?.link.to;
  const isCurrent = (l: NavItem) => l.to === activeDestination;
  const matches = (group: string | undefined, l: NavItem) => `${group ?? ''} ${__uiText(group ?? '')} ${l.label} ${__uiText(l.label)} ${l.description ? __uiText(l.description) : ''}`.toLowerCase().includes(q);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cx(
      'rounded-lg min-h-11 px-3 py-2.5 flex items-center gap-2.5 transition-colors duration-150 text-[13px]',
      isActive ? 'bg-primary-container text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low',
    );
  const subLinkCls = ({ isActive }: { isActive: boolean }) =>
    cx(
      'rounded-lg min-h-10 px-3 py-2 flex items-center gap-2 transition-colors duration-150 text-[13px]',
      isActive ? 'bg-primary-container text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low',
    );

  return (
    <aside className="relative md:fixed top-0 left-0 md:h-screen w-full md:w-64 z-30 flex flex-col justify-between py-4 px-3 border-b md:border-b-0 md:border-r border-secondary-container bg-surface-container-lowest select-none">
      <div className="flex flex-col flex-1 min-h-0 max-h-[70vh] md:max-h-none overflow-y-auto pr-1">
        <div className="px-2.5 pt-1 pb-3 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-on-primary shrink-0 shadow-sm">
            <Icon name={brand.icon ?? 'hub'} size={20} />
          </div>
          <div className="min-w-0">
            <div className="font-headline text-sm font-semibold tracking-tight text-on-surface leading-tight truncate">{brand.title}</div>
            {brand.subtitle && <div className="text-[11px] text-on-surface-variant truncate">{__uiText(brand.subtitle)}</div>}
            {env && <div className="text-[11px] text-on-surface-variant font-mono flex items-center gap-1.5 mt-0.5">{env}</div>}
          </div>
          <Button className="md:hidden ml-auto shrink-0" variant="ghost" icon={mobileOpen ? 'close' : 'menu'} aria-expanded={mobileOpen} aria-controls={navId} onClick={() => setMobileOpen(!mobileOpen)}>{__uiText("เมนู")}</Button>
        </div>

        {searchable && (
          <div className={cx('px-1.5 mb-3', !mobileOpen && 'hidden md:block')}>
            <div className="relative flex items-center w-full">
              <Icon name="search" size={16} className="absolute left-2 text-outline pointer-events-none" />
              <input
                type="search"
                aria-label={__uiText("ค้นหาเมนู")}
                className="w-full pl-7 pr-2 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-transparent focus:border-outline-variant focus:bg-surface-container-lowest rounded-lg text-xs outline-none transition-all"
                placeholder={__uiText("ค้นหาเมนู…")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        )}

        <nav id={navId} className={cx('space-y-3', !mobileOpen && 'hidden md:block')} onClick={(event) => { if ((event.target as HTMLElement).closest('a')) setMobileOpen(false); }}>
          {nav.map((section, gi) => {
            const links = q ? section.links.filter((l) => matches(section.group, l)) : section.links;
            if (!links.length) return null;
            // Untitled group: a flat list of top-level links (portal, "Overview").
            if (!section.group) {
              return (
                <div key={gi} className="space-y-0.5">
                  {links.map((l) => (
                    <Link key={l.to} to={l.to} title={l.description ? __uiText(l.description) : undefined} aria-current={isCurrent(l) ? 'page' : undefined} className={linkCls({ isActive: isCurrent(l) })}>
                      <Icon name={l.icon ?? 'circle'} />
                      <span className="flex-1 truncate">{__uiText(l.label)}</span>
                      {l.badge}
                    </Link>
                  ))}
                </div>
              );
            }
            const expanded = Boolean(q) || (toggled[section.group] ?? section.links.some(isCurrent));
            const holdsCurrent = section.links.some(isCurrent);
            // "show more": less used items follow a toggle item (same look as the others) unless searching or one is open
            const moreCount = links.filter((l) => l.more).length;
            const moreOpen = Boolean(q) || (showMore[section.group] ?? links.some((l) => l.more && isCurrent(l)));
            const shown = moreOpen ? links : links.filter((l) => !l.more);
            return (
              <div key={section.group}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`${navId}-${gi}`}
                  onClick={() => setToggled((t) => ({ ...t, [section.group as string]: !expanded }))}
                  className="w-full min-h-11 px-2.5 py-2.5 flex items-center justify-between gap-2 hover:bg-surface-container-low rounded-lg text-left transition-colors"
                >
                  <span className={cx('flex min-w-0 items-center gap-2 text-[13px]', holdsCurrent ? 'text-primary font-semibold' : 'text-on-surface-variant font-medium')}>
                    {section.icon && <Icon name={section.icon} size={16} />}
                    <span>{__uiText(section.group)}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Count>{links.length}</Count>
                    <Icon name={expanded ? 'expand_more' : 'chevron_right'} size={16} className="text-outline" />
                  </span>
                </button>
                {expanded && (
                  <div id={`${navId}-${gi}`} className="mt-0.5 space-y-0.5 pl-1.5 border-l-2 border-primary/20 ml-3">
                    {shown.map((l) => (
                      <Link key={l.to} to={l.to} title={l.description ? __uiText(l.description) : undefined} aria-current={isCurrent(l) ? 'page' : undefined} className={subLinkCls({ isActive: isCurrent(l) })}>
                        <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', isCurrent(l) ? 'bg-primary' : 'bg-outline-variant')} />
                        <span className="flex-1 truncate">{__uiText(l.label)}</span>
                        {l.badge}
                      </Link>
                    ))}
                    {moreCount > 0 && !q && (
                      <button type="button" aria-expanded={moreOpen} onClick={() => setShowMore((m) => ({ ...m, [section.group as string]: !moreOpen }))} className={cx(subLinkCls({ isActive: false }), 'w-full text-left')}>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-outline-variant" />
                        <span className="flex-1 truncate">{moreOpen ? __uiText('แสดงน้อยลง') : __uiText('แสดงเพิ่มเติม ({0})', { 0: moreCount })}</span>
                        <Icon name={moreOpen ? 'expand_more' : 'chevron_right'} size={16} className="text-outline" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {q && !nav.some(group => group.links.some(link => matches(group.group, link))) && <p role="status" className="px-3 py-4 text-xs text-on-surface-variant">{__uiText("ไม่พบเมนู ลองใช้คำอื่น")}</p>}
        </nav>
      </div>

      {(user || footer) && (
        <div className={cx('pt-2 mt-2 border-t border-secondary-container space-y-1', !mobileOpen && 'hidden md:block')}>
          {footer}
          {user && (
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-surface-container-low">
              <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-xs font-semibold shrink-0">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-on-surface truncate">{user.name}</div>
                {user.detail && <div className="text-[10px] text-on-surface-variant truncate font-mono">{user.detail}</div>}
              </div>
              {user.onSignOut && (
                <button type="button" onClick={user.onSignOut} className="text-outline hover:text-error p-1 rounded transition-colors" title={__uiText("ออกจากระบบ")} aria-label={__uiText("ออกจากระบบ")}>
                  <Icon name="logout" size={17} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

/** Slim sticky top bar to the right of the sidebar. */
export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 w-full bg-surface-container-lowest/95 border-b border-secondary-container min-h-16 flex items-center backdrop-blur-sm">
      <div className="flex flex-wrap justify-between items-center px-3 md:px-6 py-2 w-full gap-2 md:gap-4">
        <div className="flex flex-wrap items-center gap-2 md:gap-5 text-xs text-on-surface-variant min-w-0">{left}</div>
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">{right}</div>
      </div>
    </header>
  );
}

/** Icon-only top bar button. */
export function IconButton({ icon, title, onClick, dot }: { icon: string; title: string; onClick?: () => void; dot?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg transition-colors relative">
      <Icon name={icon} size={18} />
      {dot && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-rose-500 rounded-full" />}
    </button>
  );
}

/** Sidebar + top bar + scrolling main area. */
export function AppShell({ sidebar, topbar, children }: { sidebar: ReactNode; topbar?: ReactNode; children: ReactNode }) {
  __useUiLocale();
  return (
    <div className="min-h-screen bg-background">
      {sidebar}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-white">{__uiText("ข้ามไปเนื้อหา")}</a>
      <div className="md:ml-64 min-w-0 flex flex-col min-h-screen">
        {topbar}
        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 p-4 md:p-7 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- modal

export function Modal({ title, onClose, children, footer, width = 480 }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  __useUiLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => {
      node?.close();
      // React removes the dialog before passive cleanup, so native focus restoration
      // cannot reliably run. Restore its connected trigger explicitly.
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className={cx(panelCls, 'm-auto w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto p-0 shadow-xl backdrop:bg-inverse-surface/40')} style={{ maxWidth: width }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-container">
          <h2 id={titleId} className="min-w-0 text-sm font-semibold break-words [overflow-wrap:anywhere]">{title}</h2>
          <div className="flex shrink-0 items-center gap-2"><LanguageSelector />
          <button type="button" onClick={onClose} aria-label={__uiText("ปิด")} className="text-outline hover:text-on-surface">
            <Icon name="close" size={18} />
          </button></div>
        </div>
        <div className="p-4 space-y-3 text-xs">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-secondary-container flex justify-end gap-2">{footer}</div>}
    </dialog>
  );
}

// ---------------------------------------------------------------- formatters (shared; pages had their own copies)

export const fmt = {
  num: (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US')),
  baht: (n: number | string | null | undefined, digits = 2) =>
    n === null || n === undefined || n === '' ? '—' : `฿${Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`,
  /** "24 ต.ค. 2026 10:42" */
  when: (d: string | number | Date | null | undefined) =>
    d ? new Date(d).toLocaleString(getUiLocale() === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
  date: (d: string | number | Date | null | undefined) =>
    d ? new Date(d).toLocaleDateString(getUiLocale() === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
  /** "3 นาทีที่แล้ว" */
  ago: (d: string | number | Date | null | undefined) => {
    if (!d) return '—';
    const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
    if (!Number.isFinite(s)) return '—';
    const [value, unit] = s < 60 ? [-Math.max(s, 0), 'second'] : s < 3600 ? [-Math.round(s / 60), 'minute'] : s < 86400 ? [-Math.round(s / 3600), 'hour'] : [-Math.round(s / 86400), 'day'];
    return new Intl.RelativeTimeFormat(getUiLocale() === 'th' ? 'th-TH' : 'en-GB', { numeric: 'always' }).format(value as number, unit as Intl.RelativeTimeFormatUnit);
  },
};
export { LanguageSelector, UiSentence, getUiLocale, setUiLocale, uiText, formatUiMessage, useUiLocale, hasUiText } from './i18n';
export { TaskPageFrame } from './TaskPageFrame';

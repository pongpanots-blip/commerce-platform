import React, { ReactNode } from 'react';

/**
 * Stand-in for josh shared-ui-web `Select` (same props; josh draws a custom menu over a hidden
 * native <select>, here the native one is shown). onChange still gets a real <select> change event.
 */
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  data?: { value: string | number; label: string; disabled?: boolean }[];
  placeholder?: string;
  label?: string;
  hint?: string;
  error?: string;
  children?: ReactNode;
}

export function Select({ data, placeholder, className = '', label, hint, error, id, children, ...props }: SelectProps) {
  const gen = React.useId();
  const selectId = id ?? gen;
  return (
    <div className={className || 'w-full'}>
      {label && <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-ink">{label}</label>}
      <select id={selectId} aria-invalid={error ? true : undefined}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink ${error ? 'border-alert' : 'border-primary-border'} disabled:bg-surface disabled:text-ink-disabled`}
        {...props}>
        {placeholder != null && <option value="" disabled hidden={props.value !== ''}>{placeholder}</option>}
        {children ?? data?.map((o) => <option key={String(o.value)} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      {error ? <p className="mt-1 text-xs text-alert">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export { Table } from './table';
export type { TableColumn } from './table';

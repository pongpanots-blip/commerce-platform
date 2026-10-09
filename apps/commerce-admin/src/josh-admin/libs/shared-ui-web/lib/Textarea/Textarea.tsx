import { fieldExample, fieldHint, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import React from 'react';

// สืบทอดคุณสมบัติมาตรฐานของแท็ก <textarea> มาทั้งหมดเพื่อให้ใช้งานง่าย
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Textarea({ className = '', label, hint, error, id, disabled, required, placeholder, ...props }: TextareaProps) {
  __useUiLocale();
  const generatedId = React.useId();
  const textareaId = label ? (id ?? generatedId) : id;
  const messageId = `${generatedId}-message`;
  const example = placeholder ?? (label ? fieldExample('text') : undefined);
  const help = hint ?? (label ? fieldHint(required) : undefined);

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={textareaId} className="mb-1 block text-sm text-ink-secondary">
          {__uiText(label)}
          {required && <span className="text-alert"> *</span>}
        </label>
      )}
      <textarea
        id={textareaId}
        disabled={disabled}
        required={required}
        placeholder={example ? __uiText(example) : undefined}
        // Figma "Data Entry / Text Area" — กล่องเดียวกับ Basic Input, padding 10px 12px, สูงตาม rows
        // ponytail: border-2 คงที่ตลอด (เหมือน Input) กันความสูงกระโดดตอนโฟกัส
        className={`
          w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink placeholder-ink-muted
          transition-colors focus:outline-none
          ${error
            ? 'border-alert'
            : 'border-gray-200 hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/10'}
          disabled:border-surface-disabled disabled:bg-surface-disabled disabled:text-ink-disabled
          ${className}
        `}
        {...props}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={[props['aria-describedby'], (error || help) && messageId].filter(Boolean).join(' ') || undefined}
      />
      {error ? (
        <p id={messageId} className="mt-1 text-sm text-alert">{__uiText(error)}</p>
      ) : (
        help && <p id={messageId} className="mt-1 text-xs text-ink-muted">{__uiText(help)}</p>
      )}
    </div>
  );
}

export default Textarea;

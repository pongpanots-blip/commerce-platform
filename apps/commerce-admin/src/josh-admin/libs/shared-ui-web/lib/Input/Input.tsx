import { blankFieldMessage, fieldExample, fieldHint, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import React, { ReactNode } from 'react';

// สืบทอดคุณสมบัติมาตรฐานของแท็ก <input> มาทั้งหมดเพื่อให้ใช้งานง่าย
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  placeholder?: string;
  label?: string;
  hint?: string;
  /** ข้อความ error — แสดงเป็นบรรทัด B3 สีแดงใต้ช่อง และเปลี่ยนขอบเป็นสีแดง */
  error?: string;
  /** หน่วยที่ชิดขวาในช่อง เช่น "กก." / "บาท" */
  unit?: string;
  /** ไอคอนนำหน้า (เช่นแว่นขยายของช่องค้นหา) — ขนาดแนะนำ 20px */
  icon?: ReactNode;
}

export function Input({
  placeholder,
  className = '',
  type = 'text',
  label,
  hint,
  error,
  unit,
  icon,
  id,
  disabled,
  required,
  ...props
}: InputProps) {
  __useUiLocale();
  const generatedId = React.useId();
  const inputId = label ? (id ?? generatedId) : id;
  const messageId = `${generatedId}-message`;
  const example = placeholder ?? (label ? fieldExample(type) : undefined);
  const help = hint ?? (label ? fieldHint(required) : undefined);
  const [blank, setBlank] = React.useState(false);
  const shownError = error || (blank && label ? blankFieldMessage(label, example) : '');

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm text-ink-secondary">
          {__uiText(label)}
          {required && <span className="text-alert"> *</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted">
            {icon}
          </span>
        )}
        <input
          id={inputId}
          type={type}
          placeholder={example ? __uiText(example) : undefined}
          disabled={disabled}
          required={required}
          // Figma "Data Entry / Basic Input" — h-40 px-12 radius-8, ขอบ #DEEAFF → primary ตอน hover/focus
          // ponytail: border-2 คงที่ตลอด (ไม่ใช่ 1px→2px) กันความสูงกระโดดตอนโฟกัส — สีเข้มขึ้นแทนความหนา
          className={`
            h-10 w-full rounded-lg border bg-white px-3 text-sm text-ink placeholder-ink-muted
            transition-colors
            ${icon ? 'pl-9' : ''}
            ${unit ? 'pr-9' : ''}
            ${shownError
              ? 'border-alert'
              : 'border-gray-200 hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/10'}
            focus:outline-none
            disabled:border-surface-disabled disabled:bg-surface-disabled disabled:text-ink-disabled
            ${className}
          `}
          {...props}
          aria-invalid={shownError ? true : props['aria-invalid']}
          aria-describedby={[props['aria-describedby'], (shownError || help) && messageId].filter(Boolean).join(' ') || undefined}
          onBlur={(event) => {
            props.onBlur?.(event);
            if (required && label && !event.target.value.trim()) setBlank(true);
          }}
          onChange={(event) => {
            props.onChange?.(event);
            if (event.target.value.trim()) setBlank(false);
          }}
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-muted">
            {__uiText(unit)}
          </span>
        )}
      </div>
      {shownError ? (
        <p id={messageId} className="mt-1 text-sm text-alert">{__uiText(shownError)}</p>
      ) : (
        help && <p id={messageId} className="mt-1 text-xs text-ink-muted">{__uiText(help)}</p>
      )}
    </div>
  );
}

export default Input;

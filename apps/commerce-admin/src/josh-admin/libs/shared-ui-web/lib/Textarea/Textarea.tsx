import React from 'react';

// สืบทอดคุณสมบัติมาตรฐานของแท็ก <textarea> มาทั้งหมดเพื่อให้ใช้งานง่าย
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Textarea({ className = '', label, hint, error, id, disabled, ...props }: TextareaProps) {
  const generatedId = React.useId();
  const textareaId = label ? (id ?? generatedId) : id;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={textareaId} className="mb-1 block text-sm text-ink-secondary">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        disabled={disabled}
        // Figma "Data Entry / Text Area" — กล่องเดียวกับ Basic Input, padding 10px 12px, สูงตาม rows
        // ponytail: border-2 คงที่ตลอด (เหมือน Input) กันความสูงกระโดดตอนโฟกัส
        className={`
          w-full rounded-lg border-2 bg-white px-3 py-2.5 text-sm text-ink placeholder-ink-muted
          transition-colors focus:outline-none
          ${error
            ? 'border-alert'
            : 'border-primary-border hover:border-primary focus:border-primary'}
          disabled:border-surface-disabled disabled:bg-surface-disabled disabled:text-ink-disabled
          ${className}
        `}
        {...props}
      />
      {error ? (
        <p className="mt-1 text-sm text-alert">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

export default Textarea;

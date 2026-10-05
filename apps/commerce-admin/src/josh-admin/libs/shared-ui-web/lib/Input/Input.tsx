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
  const generatedId = React.useId();
  const inputId = label ? (id ?? generatedId) : id;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm text-ink-secondary">
          {label}
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
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          // Figma "Data Entry / Basic Input" — h-40 px-12 radius-8, ขอบ #DEEAFF → primary ตอน hover/focus
          // ponytail: border-2 คงที่ตลอด (ไม่ใช่ 1px→2px) กันความสูงกระโดดตอนโฟกัส — สีเข้มขึ้นแทนความหนา
          className={`
            h-10 w-full rounded-lg border-2 bg-white px-3 text-sm text-ink placeholder-ink-muted
            transition-colors
            ${icon ? 'pl-9' : ''}
            ${unit ? 'pr-9' : ''}
            ${error
              ? 'border-alert'
              : 'border-primary-border hover:border-primary focus:border-primary'}
            focus:outline-none
            disabled:border-surface-disabled disabled:bg-surface-disabled disabled:text-ink-disabled
            ${className}
          `}
          {...props}
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-muted">
            {unit}
          </span>
        )}
      </div>
      {error ? (
        <p className="mt-1 text-sm text-alert">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

export default Input;

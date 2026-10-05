import { MouseEvent, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'alert' | 'secondaryAlert' | 'danger';

interface ButtonProps {
  text?: string;
  children?: ReactNode;
  /** ไอคอนนำหน้าตัวหนังสือ (แนะนำขนาด 20px ตาม Figma) */
  icon?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  variant?: ButtonVariant;
  className?: string;
}

// Figma "General / Button" — h-40 px-12 gap-8 radius-8, ตัวหนังสือ S6 (14/20 semibold)
const VARIANT_CLASS: Record<'primary' | 'secondary' | 'alert' | 'secondaryAlert', string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark',
  secondary: 'bg-primary-soft text-primary hover:bg-primary-light hover:text-white',
  alert: 'bg-alert text-white hover:bg-alert-dark',
  secondaryAlert: 'bg-alert-soft text-alert hover:bg-alert-light hover:text-white',
};

export function Button({
  text = '',
  children,
  icon,
  onClick,
  disabled,
  type = 'button',
  variant = 'primary',
  className = '',
}: ButtonProps) {
  // 'danger' คือชื่อ variant เดิมก่อนอัปเดตดีไซน์ — map ไป 'alert' ให้ caller เก่าไม่พัง
  const resolvedVariant = variant === 'danger' ? 'alert' : variant;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:bg-surface-disabled disabled:text-ink-disabled ${VARIANT_CLASS[resolvedVariant]} ${className}`}
    >
      {icon}
      {children ?? text}
    </button>
  );
}

export default Button;

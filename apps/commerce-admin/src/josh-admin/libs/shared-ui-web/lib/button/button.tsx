import { MouseEvent, ReactNode } from 'react';
import { Button as WorkspaceButton, useUiLocale } from '@cp/ui';

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
  useUiLocale();
  const resolvedVariant = variant === 'alert' || variant === 'danger' ? 'danger' : variant === 'secondaryAlert' ? 'danger-ghost' : variant;
  return (
    <WorkspaceButton
      type={type}
      onClick={onClick}
      disabled={disabled}
      variant={resolvedVariant}
      className={className}
    >
      {icon}
      {children ?? text}
    </WorkspaceButton>
  );
}

export default Button;

import React from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

/** On-off switch for `coupons.is_active`, shown in the page header on create/edit. */
export function CouponActiveSwitch({ checked, onChange, disabled }: Props) {
  __useUiLocale();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={__uiText("เปิดใช้งานคูปอง")}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked
          ? 'border-ok/20 bg-ok-container text-ok'
          : 'border-outline-variant bg-surface-container text-on-surface-variant'
      }`}
    >
      <span
        aria-hidden
        className={`relative inline-block h-6 w-11 shrink-0 rounded-full shadow-inner transition-colors duration-200 ${
          checked ? 'bg-ok' : 'bg-outline-variant'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
      {checked ? __uiText("เปิดใช้งาน") : __uiText("ปิดใช้งาน")}
    </button>
  );
}

export default CouponActiveSwitch;

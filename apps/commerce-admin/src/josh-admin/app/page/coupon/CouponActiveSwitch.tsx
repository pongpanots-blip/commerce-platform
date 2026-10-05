import React from 'react';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

/** Green/red on-off switch for `coupons.is_active`, shown in the page header on create/edit. */
export function CouponActiveSwitch({ checked, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="เปิดใช้งานคูปอง"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 focus-visible:ring-emerald-500'
          : 'border-red-200 bg-red-50 text-red-700 focus-visible:ring-red-500'
      }`}
    >
      <span
        aria-hidden
        className={`relative inline-block h-6 w-11 shrink-0 rounded-full shadow-inner transition-colors duration-200 ${
          checked ? 'bg-emerald-500' : 'bg-red-500'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
      {checked ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
    </button>
  );
}

export default CouponActiveSwitch;

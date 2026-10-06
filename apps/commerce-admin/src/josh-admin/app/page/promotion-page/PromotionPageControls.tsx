import type { ReactNode } from 'react';

/** On/off switch with a label (the coupon one is hard-wired to "เปิดใช้งานคูปอง"). */
export function SwitchField({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border-2 border-primary-border p-3">
      <div>
        <p className="text-sm text-ink">{label}</p>
        {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-block h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? 'bg-primary' : 'bg-ink-disabled'
        }`}
      >
        <span
          aria-hidden
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

/** เปิด/ปิดใช้งาน pill — same shape as `CampaignStatusPill`, for things with no derived status. */
export function ActivePill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
        active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }`}
    >
      {active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
    </span>
  );
}

/**
 * Same look as the coupon form's `Section`, but the heading level is a parameter: the page
 * form sits inside a card of the campaign hub, where its sections are h3 under the card's h2.
 */
export function FormSection({
  title,
  description,
  level = 2,
  children,
}: {
  title: string;
  description?: string;
  level?: 2 | 3;
  children: ReactNode;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className="space-y-4 border-t border-gray-100 pt-5 first:border-t-0 first:pt-0">
      <div>
        <Heading className="text-sm font-semibold text-gray-900">{title}</Heading>
        {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

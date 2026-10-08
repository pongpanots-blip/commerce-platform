import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
export type CampaignStatus = 'inactive' | 'scheduled' | 'live' | 'ended';

const PILLS: Record<CampaignStatus, { label: string; className: string }> = {
  inactive: { get label() { return __uiText("ปิดใช้งาน"); }, className: 'bg-red-50 text-red-700' },
  scheduled: { get label() { return __uiText("ตั้งเวลาไว้"); }, className: 'bg-amber-50 text-amber-700' },
  live: { get label() { return __uiText("กำลังใช้งาน"); }, className: 'bg-green-50 text-green-700' },
  ended: { get label() { return __uiText("สิ้นสุดแล้ว"); }, className: 'bg-gray-100 text-gray-500' },
};

export default function CampaignStatusPill({
  status,
}: {
  status: CampaignStatus;
}) {
  __useUiLocale();
  const pill = PILLS[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${pill.className}`}
    >
      {pill.label}
    </span>
  );
}

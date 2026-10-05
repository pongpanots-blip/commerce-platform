export type CampaignStatus = 'inactive' | 'scheduled' | 'live' | 'ended';

const PILLS: Record<CampaignStatus, { label: string; className: string }> = {
  inactive: { label: 'ปิดใช้งาน', className: 'bg-red-50 text-red-700' },
  scheduled: { label: 'ตั้งเวลาไว้', className: 'bg-amber-50 text-amber-700' },
  live: { label: 'กำลังใช้งาน', className: 'bg-green-50 text-green-700' },
  ended: { label: 'สิ้นสุดแล้ว', className: 'bg-gray-100 text-gray-500' },
};

export default function CampaignStatusPill({
  status,
}: {
  status: CampaignStatus;
}) {
  const pill = PILLS[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${pill.className}`}
    >
      {pill.label}
    </span>
  );
}

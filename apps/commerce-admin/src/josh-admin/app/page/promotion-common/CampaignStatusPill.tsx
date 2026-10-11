import { Chip, type Tone, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
export type CampaignStatus = 'inactive' | 'scheduled' | 'live' | 'ended';

const PILLS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  inactive: { get label() { return __uiText("ปิดใช้งาน"); }, tone: 'danger' },
  scheduled: { get label() { return __uiText("ตั้งเวลาไว้"); }, tone: 'warn' },
  live: { get label() { return __uiText("กำลังใช้งาน"); }, tone: 'ok' },
  ended: { get label() { return __uiText("สิ้นสุดแล้ว"); }, tone: 'muted' },
};

export default function CampaignStatusPill({
  status,
}: {
  status: CampaignStatus;
}) {
  __useUiLocale();
  const pill = PILLS[status];
  return <Chip tone={pill.tone} statusCode={status} dot>{pill.label}</Chip>;
}

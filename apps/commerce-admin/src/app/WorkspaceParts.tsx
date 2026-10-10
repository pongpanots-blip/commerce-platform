import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chip, Icon, Panel, PanelHead } from '@cp/ui';
import { commerceText as text } from './commerce-copy';

export function WorkspaceMetric({ label, value, reason, note }: { label: string; value?: ReactNode; reason?: string; note?: string }) {
  const available = value !== undefined && value !== null;
  return <Panel><div className="p-4 space-y-2">
    <h2 className="text-sm font-medium text-on-surface-variant">{label}</h2>
    <p className="text-2xl font-semibold tabular-nums text-on-surface">{available ? value : '—'}</p>
    {!available && <Chip tone="muted">{text('ยังไม่มีข้อมูล', 'Unavailable')}</Chip>}
    <p className="text-xs leading-relaxed text-on-surface-variant">{available ? note : reason ?? text('ยังไม่มีแหล่งข้อมูลที่ยืนยันค่าได้', 'No verified source for this value.')}</p>
  </div></Panel>;
}

export function TaskLinks({ title, children }: { title: string; children: ReactNode }) {
  return <Panel><PanelHead title={title} /><div className="p-4 space-y-3">{children}</div></Panel>;
}

export function WorkspaceLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-secondary-container p-3 text-sm font-medium text-primary hover:bg-primary-container/30 focus-visible:outline-2 focus-visible:outline-primary">
    <span>{children}</span><Icon name="arrow_forward" size={17} className="shrink-0" />
  </Link>;
}

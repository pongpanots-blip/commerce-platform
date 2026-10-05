export const WON_STAGES = new Set<string>(['signed', 'won', 'reactivated', 'ordering_again']);
export const CONTACTED_STAGES = new Set<string>([
  'contacted',
  'appointment',
  'negotiate',
  'interested',
  'signed',
  'won',
  'rejected',
  'lost',
]);

export function isWon(stage: string, health: string): boolean {
  return WON_STAGES.has(stage) || health === 'active_again';
}

/**
 * Average whole-day gap between start and end across rows.
 * Rows with a null/invalid/negative end are ignored; `avg` is null when
 * no row qualifies. `sample` is the number of rows that contributed.
 */
export function avgDays(
  rows: { start: Date | string; end: Date | string | null }[],
): { avg: number | null; sample: number } {
  const DAY = 1000 * 60 * 60 * 24;
  const gaps: number[] = [];
  for (const r of rows) {
    if (!r.end) continue;
    const start = new Date(r.start).getTime();
    const end = new Date(r.end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    gaps.push(Math.floor((end - start) / DAY));
  }
  if (gaps.length === 0) return { avg: null, sample: 0 };
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return { avg: Math.round(avg * 10) / 10, sample: gaps.length };
}

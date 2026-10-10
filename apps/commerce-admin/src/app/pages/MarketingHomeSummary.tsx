import { ErrorText, Loading } from '@cp/ui';
import { api } from '../../lib/api';
import { useAsync } from '../hooks';
import { commerceText as text } from '../commerce-copy';
import { getUiLocale } from '@cp/ui';
import { WorkspaceMetric } from '../WorkspaceParts';

type Metric = { key: string; value: number | null; availability: 'available' | 'partial' | 'unavailable'; definition: string; reason: string | null };
export function marketingHomeMetrics(raw: unknown): Metric[] {
  const body = raw as Record<string, unknown> | null;
  if (!body || body.schemaVersion !== 1 || body.role !== 'marketing' || !Array.isArray(body.metrics)) throw new Error('Home summary could not be verified.');
  const keys = new Set<string>();
  for (const item of body.metrics) {
    const m = item as Metric;
    if (!m || typeof m.key !== 'string' || keys.has(m.key) || typeof m.definition !== 'string' ||
      !['available', 'partial', 'unavailable'].includes(m.availability) ||
      !(m.value === null || typeof m.value === 'number' && Number.isFinite(m.value)) ||
      (m.availability === 'unavailable' ? m.value !== null : m.value === null) ||
      !(m.reason === null || typeof m.reason === 'string')) throw new Error('Home summary could not be verified.');
    keys.add(m.key);
  }
  if (['priced_records', 'sessions', 'recorded_sent', 'roas'].some(key => !keys.has(key))) throw new Error('Home summary could not be verified.');
  if (body.failedSources !== undefined && (!Array.isArray(body.failedSources) || body.failedSources.some(source => !['catalog', 'traffic', 'push'].includes(source)))) throw new Error('Home summary could not be verified.');
  return body.metrics as Metric[];
}
export function MarketingHomeSummary() {
  const home = useAsync(async () => {
    const raw = await api.get<Record<string, unknown>>('/reports/home?period=this_month');
    return { metrics: marketingHomeMetrics(raw), partial: Array.isArray(raw.failedSources) && raw.failedSources.length > 0 };
  });
  const definitions = [
    ['priced_records', 'สินค้าที่มีราคาขาย', 'Products with a selling price', 'นับราคาที่มากกว่า 0 ยังไม่ยืนยันว่าราคาถูกต้อง', 'Positive prices; correctness is not verified.'],
    ['sessions', 'การเข้าชมเดือนนี้', 'Visits this month', 'นับการเข้าชม ยังไม่ได้เชื่อมกับยอดขายจากแคมเปญ', 'Visits, not campaign-attributed sales.'],
    ['recorded_sent', 'ข้อความที่มีบันทึกส่ง', 'Recorded push sends', 'นับจากแคมเปญล่าสุดไม่เกิน 200 รายการ ยังไม่ยืนยันว่าลูกค้าได้รับแล้ว', 'Recorded sends from the latest 200 campaigns; final delivery is not verified.'],
    ['roas', 'ผลตอบแทนค่าโฆษณา', 'ROAS', 'ต้องมีค่าโฆษณาและยอดขายที่เชื่อมกับแคมเปญในขอบเขตเดียวกัน', 'Requires compatible spend and attributed sales.'],
  ];
  return <>
    <ErrorText error={home.error ?? (home.data?.partial ? text('โหลดข้อมูลบางส่วนไม่สำเร็จ ยังดูข้อมูลที่มีได้ หรือลองอีกครั้ง', 'Some summary sources could not be read. Available evidence is retained; try again.') : null)} onRetry={home.reload} />
    {home.loading && !home.data ? <Loading variant="detail" /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{definitions.map(([key, th, en, noteTh, noteEn]) => {
      const m = !home.error ? home.data?.metrics.find(metric => metric.key === key) : undefined;
      return <WorkspaceMetric key={key} label={text(th, en)} value={m?.value ?? undefined}
        reason={key === 'roas' ? text('ไม่มีข้อมูลค่าโฆษณาและยอดขายที่ระบุที่มา', 'Spend and attributed sales are unavailable.') : m?.reason && getUiLocale() === 'en' ? m.reason : text('สรุปยังไม่ครบ ลองอีกครั้งหรือเปิดรายการจริงด้านล่าง', 'Summary unavailable. Try again or open the records below.')}
        note={m ? `${text(noteTh, noteEn)}${m.availability === 'partial' ? ` ${text('รายงานยังไม่ครบ ควรเปิดรายการจริงเพื่อตรวจสอบ', 'Report coverage is partial; inspect the records.')}` : ''}` : undefined} />;
    })}</div>}
  </>;
}

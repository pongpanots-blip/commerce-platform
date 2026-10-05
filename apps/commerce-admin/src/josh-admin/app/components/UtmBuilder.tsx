import { useId } from 'react';
import { CopyField } from './CopyField';

export type UtmValues = {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
};

export const EMPTY_UTM: UtmValues = { source: '', medium: '', campaign: '', content: '', term: '' };

export function buildUtmQuery(utm: UtmValues): string {
  const pairs: [string, string][] = [
    ['utm_source', utm.source], ['utm_medium', utm.medium], ['utm_campaign', utm.campaign],
    ['utm_content', utm.content], ['utm_term', utm.term],
  ];
  const qs = pairs
    .filter(([, v]) => v.trim() !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim())}`)
    .join('&');
  return qs ? `?${qs}` : '';
}

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
const labelCls = 'text-xs font-semibold text-gray-500';

const FIELDS: { key: keyof UtmValues; label: string; placeholder: string }[] = [
  { key: 'source', label: 'แหล่งที่มา (utm_source)', placeholder: 'facebook' },
  { key: 'medium', label: 'ช่องทาง (utm_medium)', placeholder: 'cpc' },
  { key: 'campaign', label: 'แคมเปญ (utm_campaign)', placeholder: 'summer-sale' },
  { key: 'content', label: 'เนื้อหา (utm_content)', placeholder: 'banner-a' },
  { key: 'term', label: 'คำค้นหา (utm_term)', placeholder: 'seafood' },
];

export function UtmBuilder({
  value, baseUrl, onChange,
}: {
  value: UtmValues;
  baseUrl?: string ;
  onChange: (next: UtmValues) => void;
}) {
  const set = (k: keyof UtmValues, v: string) => onChange({ ...value, [k]: v });
  const preview = baseUrl ? `${baseUrl}${buildUtmQuery(value)}` : '';
  const idPrefix = useId();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`${idPrefix}-${f.key}`} className={labelCls}>{f.label}</label>
            <input id={`${idPrefix}-${f.key}`} className={field} value={value[f.key]} placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)} />
          </div>
        ))}
      </div>
      {baseUrl && <CopyField label="ลิงก์พร้อม UTM" value={preview} />}
    </div>
  );
}

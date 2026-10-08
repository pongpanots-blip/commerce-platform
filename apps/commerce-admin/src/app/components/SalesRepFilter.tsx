import { Field, Select, ErrorText, uiText, useUiLocale } from '@cp/ui';
import { salesAssignmentApi, session } from '../../lib/api';
import { useAsync } from '../hooks';

export function SalesRepFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  useUiLocale();
  const manager = ['admin', 'sales_manager'].includes(session.claims()?.role ?? '');
  const reps = useAsync(() => manager ? salesAssignmentApi.reps() : Promise.resolve([]), [manager]);
  if (!manager) return null;
  return <div><Field label={uiText('พนักงานขาย')}><Select value={value} onChange={e => onChange(e.target.value)}>
    <option value="">{uiText('ทุกคน')}</option>
    {(reps.data ?? []).map(rep => <option key={rep.id} value={rep.id}>{rep.name || rep.id}</option>)}
  </Select></Field><ErrorText error={reps.error} /></div>;
}

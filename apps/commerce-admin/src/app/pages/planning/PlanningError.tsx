import { Alert, Button } from '@cp/ui';
import { commerceText as text } from '../../commerce-copy';

/** Callers supply sanitized task guidance; it must stay visible without opening technical details. */
export function PlanningError({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  return error ? <Alert tone="danger" actions={onRetry && <Button type="button" onClick={onRetry}>{text('ลองอีกครั้ง', 'Try again')}</Button>}><p>{error}</p></Alert> : null;
}

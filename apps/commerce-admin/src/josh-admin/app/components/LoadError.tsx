import { Alert, Button, PageHeader, Panel, uiText, useUiLocale } from '@cp/ui';

/** Keep a failed read separate from an editable form or a successful empty result. */
export function LoadError({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  useUiLocale();
  return <div className="space-y-5">
    <PageHeader title={title} />
    <Panel>
      <Alert tone="danger">{typeof error === 'string' ? uiText(error) : uiText('โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง')}</Alert>
      {error instanceof Error && <details className="mt-4 text-sm text-on-surface-variant">
        <summary className="cursor-pointer">{uiText('รายละเอียดข้อผิดพลาด')}</summary>
        <p className="mt-2 break-words">{error.message}</p>
      </details>}
      {onRetry && <Button className="mt-4" variant="secondary" onClick={onRetry}>{uiText('ลองอีกครั้ง')}</Button>}
    </Panel>
  </div>;
}

import type { ProcessingState } from '../../types/batch-sticker';
import { Button } from '@josh/shared-ui-web';

export function ProcessingProgress({
  processing,
  onCancel,
}: {
  processing: ProcessingState;
  onCancel: () => void;
}) {
  const percent = processing.total === 0 ? 0 : Math.round(((processing.completed + processing.failed) / processing.total) * 100);

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between text-sm font-medium text-gray-700">
        <span>Processing Lot</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          {processing.completed + processing.failed} / {processing.total}
          {processing.currentFile ? ` — ${processing.currentFile}` : ''}
        </span>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default ProcessingProgress;

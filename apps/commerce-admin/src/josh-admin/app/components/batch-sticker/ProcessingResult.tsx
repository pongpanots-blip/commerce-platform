import { Button } from '@josh/shared-ui-web';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export interface ProcessingResultData {
  succeededCount: number;
  failed: Array<{ filename: string; error: string }>;
  quality: number;
}

export function ProcessingResult({
  result,
  onDownload,
  onStartNewLot,
}: {
  result: ProcessingResultData;
  onDownload: () => void;
  onStartNewLot: () => void;
}) {
  __useUiLocale();
  return (
    <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-base font-semibold text-gray-800">
        <span className="text-green-600">✓</span> {__uiText(" Lot Completed")}</div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-gray-400">{__uiText("Success")}</div>
          <div className="text-lg font-semibold text-gray-800">{result.succeededCount}</div>
        </div>
        <div>
          <div className="text-gray-400">{__uiText("Failed")}</div>
          <div className="text-lg font-semibold text-gray-800">{result.failed.length}</div>
        </div>
      </div>
      {result.failed.length > 0 && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          <div className="font-medium">{__uiText("Failed files")}</div>
          <ul className="mt-1 list-inside list-disc">
            {result.failed.map((f) => (
              <li key={f.filename}>
                {f.filename} — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-sm text-gray-500">{__uiText("Output: WebP / Quality ")}{Math.round(result.quality * 100)}</div>
      <div className="flex gap-3">
        <Button onClick={onDownload}>{__uiText("Download ZIP")}</Button>
        <Button variant="secondary" onClick={onStartNewLot}>
          {__uiText("Start New Lot")}</Button>
      </div>
    </div>
  );
}

export default ProcessingResult;

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function OutputSettings({
  quality,
  onQualityChange,
}: {
  /** 0–1 */
  quality: number;
  onQualityChange: (quality: number) => void;
}) {
  __useUiLocale();
  const qualityPercent = Math.round(quality * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">{__uiText("Output")}</span>
        <span className="text-gray-500">{__uiText("Format: WebP")}</span>
      </div>
      <label className="flex items-center gap-3 text-sm text-gray-600">
        <span className="w-24 shrink-0">{__uiText("WebP Quality")}</span>
        <input
          type="range"
          min={1}
          max={100}
          value={qualityPercent}
          onChange={(e) => onQualityChange(Number(e.target.value) / 100)}
          className="flex-1"
        />
        <span className="w-10 text-right tabular-nums">{qualityPercent}</span>
      </label>
    </div>
  );
}

export default OutputSettings;

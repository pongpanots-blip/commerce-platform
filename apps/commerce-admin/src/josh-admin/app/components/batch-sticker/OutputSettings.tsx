export function OutputSettings({
  quality,
  onQualityChange,
}: {
  /** 0–1 */
  quality: number;
  onQualityChange: (quality: number) => void;
}) {
  const qualityPercent = Math.round(quality * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">Output</span>
        <span className="text-gray-500">Format: WebP</span>
      </div>
      <label className="flex items-center gap-3 text-sm text-gray-600">
        <span className="w-24 shrink-0">WebP Quality</span>
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

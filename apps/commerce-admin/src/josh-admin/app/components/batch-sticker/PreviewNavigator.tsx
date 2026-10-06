export function PreviewNavigator({
  index,
  total,
  onChange,
}: {
  index: number;
  total: number;
  onChange: (index: number) => void;
}) {
  if (total === 0) return null;

  return (
    <div className="flex items-center justify-center gap-4 text-sm">
      <button
        type="button"
        className="rounded-md border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        disabled={index === 0}
        onClick={() => onChange(index - 1)}
        aria-label="Previous image"
      >
        ←
      </button>
      <span className="tabular-nums text-gray-700">
        {index + 1} / {total}
      </span>
      <button
        type="button"
        className="rounded-md border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        disabled={index >= total - 1}
        onClick={() => onChange(index + 1)}
        aria-label="Next image"
      >
        →
      </button>
    </div>
  );
}

export default PreviewNavigator;

export function UndoRedoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        disabled={!canUndo}
        onClick={onUndo}
        title="Undo (Ctrl/Cmd+Z)"
      >
        ↶ Undo
      </button>
      <button
        type="button"
        className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        disabled={!canRedo}
        onClick={onRedo}
        title="Redo (Ctrl/Cmd+Shift+Z)"
      >
        ↷ Redo
      </button>
    </div>
  );
}

export default UndoRedoControls;

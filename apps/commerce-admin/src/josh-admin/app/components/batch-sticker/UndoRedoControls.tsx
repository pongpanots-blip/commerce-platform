// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
  __useUiLocale();
  return (
    <div className="flex gap-2">
      <button
        type="button"
        className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        disabled={!canUndo}
        onClick={onUndo}
        title={__uiText("Undo (Ctrl/Cmd+Z)")}
      >
        {__uiText("↶ Undo")}</button>
      <button
        type="button"
        className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        disabled={!canRedo}
        onClick={onRedo}
        title={__uiText("Redo (Ctrl/Cmd+Shift+Z)")}
      >
        {__uiText("↷ Redo")}</button>
    </div>
  );
}

export default UndoRedoControls;

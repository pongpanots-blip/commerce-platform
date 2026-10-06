import { useState } from 'react';
import type { StickerPreset } from '../../types/batch-sticker';

export function PresetManager({
  presets,
  onSave,
  onApply,
  onRename,
  onDelete,
}: {
  presets: StickerPreset[];
  onSave: (name: string) => void;
  onApply: (preset: StickerPreset) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  return (
    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
      <div className="text-sm font-medium text-gray-700">Position Presets</div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm"
          placeholder="Preset name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          disabled={!newName.trim()}
          onClick={() => {
            onSave(newName.trim());
            setNewName('');
          }}
        >
          Save
        </button>
      </div>

      {presets.length === 0 && <p className="text-sm text-gray-400">No saved presets yet.</p>}

      <ul className="space-y-1">
        {presets.map((preset) => (
          <li key={preset.id} className="flex items-center justify-between gap-2 rounded-md border border-gray-100 px-2 py-1 text-sm">
            {renamingId === preset.id ? (
              <input
                className="flex-1 rounded-md border border-gray-200 px-1"
                value={renameValue}
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  if (renameValue.trim()) onRename(preset.id, renameValue.trim());
                  setRenamingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            ) : (
              <button type="button" className="flex-1 truncate text-left" onClick={() => onApply(preset)}>
                {preset.name}
              </button>
            )}
            <div className="flex shrink-0 gap-1 text-gray-400">
              <button
                type="button"
                aria-label="Rename preset"
                className="hover:text-gray-700"
                onClick={() => {
                  setRenamingId(preset.id);
                  setRenameValue(preset.name);
                }}
              >
                ✎
              </button>
              <button type="button" aria-label="Delete preset" className="hover:text-red-600" onClick={() => onDelete(preset.id)}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PresetManager;

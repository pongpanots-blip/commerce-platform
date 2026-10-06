import type { StickerLayer, StickerPreset } from '../../../types/batch-sticker';

const STORAGE_KEY = 'batchSticker.presets.v1';

function readAll(): StickerPreset[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StickerPreset[];
  } catch {
    return [];
  }
}

function writeAll(presets: StickerPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function listPresets(): StickerPreset[] {
  return readAll();
}

export function savePreset(name: string, layers: StickerLayer[]): StickerPreset {
  const preset: StickerPreset = {
    id: crypto.randomUUID(),
    name,
    layers: layers.map((layer) => ({
      transform: { ...layer.transform },
      assetFilename: layer.asset.filename,
    })),
  };

  writeAll([...readAll(), preset]);
  return preset;
}

export function renamePreset(id: string, name: string): void {
  writeAll(readAll().map((p) => (p.id === id ? { ...p, name } : p)));
}

export function deletePreset(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}

export interface ApplyPresetResult {
  updatedLayers: StickerLayer[];
  /** asset filenames from the preset that had no matching layer loaded in this session */
  skipped: string[];
}

/**
 * Restores each preset layer's transform onto the current session's
 * layer with the matching asset filename. A preset layer whose asset
 * isn't currently loaded is skipped (never guessed onto a different
 * sticker) and reported back so the caller can tell the admin.
 */
export function applyPresetToLayers(preset: StickerPreset, currentLayers: StickerLayer[]): ApplyPresetResult {
  const matchedFilenames = new Set<string>();

  const updatedLayers = currentLayers.map((layer) => {
    const match = preset.layers.find((p) => p.assetFilename === layer.asset.filename);
    if (!match) return layer;
    matchedFilenames.add(match.assetFilename);
    return { ...layer, transform: { ...match.transform } };
  });

  const skipped = preset.layers
    .filter((p) => !matchedFilenames.has(p.assetFilename))
    .map((p) => p.assetFilename);

  return { updatedLayers, skipped };
}

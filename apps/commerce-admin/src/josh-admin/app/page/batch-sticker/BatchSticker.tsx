import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { batchStickerReducer, initialBatchState } from '../../lib/batch-sticker/state/batchStickerReducer';
import { readImageDimensions } from '../../lib/batch-sticker/image/decodeImage';
import { checkResolutionConsistency } from '../../lib/batch-sticker/image/resolutionCheck';
import { processBatch } from '../../lib/batch-sticker/batch/processor';
import { buildZipBuffer, downloadFile } from '../../lib/batch-sticker/zip/createZip';
import {
  applyPresetToLayers,
  deletePreset,
  listPresets,
  renamePreset,
  savePreset,
} from '../../lib/batch-sticker/presets/presets';
import { BatchUploader } from '../../components/batch-sticker/BatchUploader';
import { StickerUploader } from '../../components/batch-sticker/StickerUploader';
import { LayerList } from '../../components/batch-sticker/LayerList';
import { PreviewCanvas } from '../../components/batch-sticker/PreviewCanvas';
import { PreviewNavigator } from '../../components/batch-sticker/PreviewNavigator';
import { ImageInfo } from '../../components/batch-sticker/ImageInfo';
import { StickerControls } from '../../components/batch-sticker/StickerControls';
import { UndoRedoControls } from '../../components/batch-sticker/UndoRedoControls';
import { PresetManager } from '../../components/batch-sticker/PresetManager';
import { OutputSettings } from '../../components/batch-sticker/OutputSettings';
import { ProcessButton } from '../../components/batch-sticker/ProcessButton';
import { ProcessingProgress } from '../../components/batch-sticker/ProcessingProgress';
import { ProcessingResult, type ProcessingResultData } from '../../components/batch-sticker/ProcessingResult';
import type { StickerAsset, StickerPreset } from '../../types/batch-sticker';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function BatchSticker() {
  __useUiLocale();
  const [state, dispatch] = useReducer(batchStickerReducer, initialBatchState);
  const [presets, setPresets] = useState<StickerPreset[]>([]);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessingResultData | null>(null);
  const zipBufferRef = useRef<ArrayBuffer | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    setPresets(listPresets());
  }, []);

  // Scan resolution for every newly-added image, lazily and one at a time
  // — never decode the whole lot at once (see spec §16).
  useEffect(() => {
    let cancelled = false;
    const pending = state.images.filter((img) => img.width === undefined);

    (async () => {
      for (const img of pending) {
        if (cancelled) return;
        try {
          const { width, height } = await readImageDimensions(img.file);
          if (!cancelled) dispatch({ type: 'SET_IMAGE_DIMENSIONS', imageId: img.id, width, height });
        } catch {
          if (!cancelled) dispatch({ type: 'SET_IMAGE_STATUS', imageId: img.id, status: 'failed', error: 'Failed to decode' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.images.length]);

  // Keyboard shortcuts for undo/redo.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const currentImage = state.images[state.previewIndex];
  const selectedLayer = state.layers.find((l) => l.id === state.selectedLayerId) ?? null;
  const resolutionCheck = checkResolutionConsistency(state.images);

  const handleProcess = useCallback(async () => {
    cancelRef.current = false;
    setResult(null);
    dispatch({ type: 'SET_PROCESSING', processing: { running: true, completed: 0, failed: 0, total: state.images.length } });

    const { succeeded, failed } = await processBatch({
      images: state.images,
      layers: state.layers,
      quality: state.output.quality,
      isCancelled: () => cancelRef.current,
      onProgress: (progress) => dispatch({ type: 'SET_PROCESSING', processing: progress }),
    });

    dispatch({ type: 'SET_PROCESSING', processing: { running: false } });

    if (succeeded.length > 0) {
      const buffer = await buildZipBuffer(succeeded.map((s) => ({ filename: s.filename, blob: s.blob })));
      zipBufferRef.current = buffer;
    }

    setResult({ succeededCount: succeeded.length, failed, quality: state.output.quality });
  }, [state.images, state.layers, state.output.quality]);

  function handleDownload() {
    if (!zipBufferRef.current) return;
    const file = new File([zipBufferRef.current], 'LOT_OUTPUT.zip', { type: 'application/zip' });
    downloadFile(file);
  }

  function handleStartNewLot() {
    setResult(null);
    zipBufferRef.current = null;
    dispatch({ type: 'CLEAR_IMAGES' });
  }

  function handleAddStickerLayer(asset: StickerAsset) {
    dispatch({
      type: 'ADD_LAYER',
      layer: {
        id: crypto.randomUUID(),
        asset,
        transform: { x: 0.7, y: 0.7, width: 0.2, height: 0.2 / asset.aspectRatio, opacity: 1, rotation: 0 },
        zIndex: 0,
        lockAspectRatio: true,
      },
    });
    setShowStickerUploader(false);
  }

  const [showStickerUploader, setShowStickerUploader] = useState(false);

  function handleSavePreset(name: string) {
    const preset = savePreset(name, state.layers);
    setPresets((prev) => [...prev, preset]);
  }

  function handleApplyPreset(preset: StickerPreset) {
    const { updatedLayers, skipped } = applyPresetToLayers(preset, state.layers);
    dispatch({ type: 'APPLY_LAYERS', layers: updatedLayers });
    setPresetNotice(
      skipped.length > 0
        ? __uiMessage("Applied \"{0}\" — skipped layer(s) not currently loaded: {1}",{"0":preset.name,"1":skipped.join(', ')})
        : __uiMessage("Applied \"{0}\"",{"0":preset.name}),
    );
  }

  function handleRenamePreset(id: string, name: string) {
    renamePreset(id, name);
    setPresets(listPresets());
  }

  function handleDeletePreset(id: string) {
    deletePreset(id);
    setPresets(listPresets());
  }

  return (
    <div className="cp-management-page space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">{__uiText("Batch Sticker")}</h1>
      </div>
      <p className="text-xs text-gray-400">
        {__uiText("Images are processed locally in your browser. Your files are not uploaded.")}</p>

      {result ? (
        <ProcessingResult result={result} onDownload={handleDownload} onStartNewLot={handleStartNewLot} />
      ) : state.processing.running ? (
        <ProcessingProgress processing={state.processing} onCancel={() => (cancelRef.current = true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-3">
            <div className="rounded-md border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-medium text-gray-700">{__uiText("LOT")}</div>
              <BatchUploader
                imageCount={state.images.length}
                onImagesAdded={(images) => dispatch({ type: 'ADD_IMAGES', images })}
              />
              {resolutionCheck.status === 'consistent' && (
                <p className="mt-2 text-sm text-green-600">
                  {__uiText("✓ All images: ")}{resolutionCheck.width} × {resolutionCheck.height}
                </p>
              )}
              {resolutionCheck.status === 'mixed' && (
                <p className="mt-2 text-sm text-amber-600">{__uiText("⚠ Mixed image resolutions detected")}</p>
              )}
            </div>

            {state.images.length === 0 ? null : state.layers.length === 0 && !showStickerUploader ? (
              <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-500">
                {state.images.length} {__uiText(" images loaded — upload a sticker to continue.")}<div className="mt-2">
                  <button
                    type="button"
                    className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => setShowStickerUploader(true)}
                  >
                    {__uiText("Upload Sticker")}</button>
                </div>
              </div>
            ) : (
              <>
                <PreviewCanvas
                  image={currentImage}
                  layers={state.layers}
                  selectedLayerId={state.selectedLayerId}
                  onSelectLayer={(id) => dispatch({ type: 'SELECT_LAYER', layerId: id })}
                  onCommitTransform={(layerId, transform) => dispatch({ type: 'COMMIT_LAYER_TRANSFORM', layerId, transform })}
                />
                <ImageInfo image={currentImage} />
                <PreviewNavigator
                  index={state.previewIndex}
                  total={state.images.length}
                  onChange={(index) => dispatch({ type: 'SET_PREVIEW_INDEX', index })}
                />
              </>
            )}

            {state.images.length > 0 && state.layers.length > 0 && (
              <>
                <OutputSettings
                  quality={state.output.quality}
                  onQualityChange={(quality) => dispatch({ type: 'SET_OUTPUT_QUALITY', quality })}
                />
                <ProcessButton
                  imageCount={state.images.length}
                  layers={state.layers}
                  quality={state.output.quality}
                  onProcess={handleProcess}
                />
              </>
            )}
          </div>

          <div className="space-y-3">
            {showStickerUploader && (
              <div className="rounded-md border border-gray-200 bg-white p-4">
                <div className="mb-2 text-sm font-medium text-gray-700">{__uiText("Add Sticker")}</div>
                <StickerUploader onAsset={handleAddStickerLayer} />
              </div>
            )}

            {state.layers.length > 0 && (
              <div className="rounded-md border border-gray-200 bg-white p-4">
                <LayerList
                  layers={state.layers}
                  selectedLayerId={state.selectedLayerId}
                  onSelect={(id) => dispatch({ type: 'SELECT_LAYER', layerId: id })}
                  onRemove={(id) => dispatch({ type: 'REMOVE_LAYER', layerId: id })}
                  onMove={(id, direction) => dispatch({ type: 'MOVE_LAYER', layerId: id, direction })}
                  onAddLayerClick={() => setShowStickerUploader(true)}
                />
              </div>
            )}

            {selectedLayer && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">{__uiText("Sticker Settings")}</span>
                  <UndoRedoControls
                    canUndo={state.history.past.length > 0}
                    canRedo={state.history.future.length > 0}
                    onUndo={() => dispatch({ type: 'UNDO' })}
                    onRedo={() => dispatch({ type: 'REDO' })}
                  />
                </div>
                <StickerControls
                  layer={selectedLayer}
                  onChange={(transform) => dispatch({ type: 'COMMIT_LAYER_TRANSFORM', layerId: selectedLayer.id, transform })}
                  onToggleLockAspectRatio={(locked) =>
                    dispatch({
                      type: 'APPLY_LAYERS',
                      layers: state.layers.map((l) => (l.id === selectedLayer.id ? { ...l, lockAspectRatio: locked } : l)),
                    })
                  }
                  onReset={() =>
                    dispatch({
                      type: 'COMMIT_LAYER_TRANSFORM',
                      layerId: selectedLayer.id,
                      transform: { x: 0.7, y: 0.7, width: 0.2, height: 0.2 / selectedLayer.asset.aspectRatio, opacity: 1, rotation: 0 },
                    })
                  }
                />
              </>
            )}

            {state.layers.length > 0 && (
              <PresetManager
                presets={presets}
                onSave={handleSavePreset}
                onApply={handleApplyPreset}
                onRename={handleRenamePreset}
                onDelete={handleDeletePreset}
              />
            )}
            {presetNotice && <p className="text-sm text-gray-500">{(typeof (presetNotice) === 'string' ? __uiText(presetNotice) : presetNotice)}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default BatchSticker;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

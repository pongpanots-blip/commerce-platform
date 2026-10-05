import type { BatchImage, BatchState, ProcessingState, StickerLayer, StickerTransform } from '../../../types/batch-sticker';

export const initialBatchState: BatchState = {
  images: [],
  previewIndex: 0,
  layers: [],
  selectedLayerId: null,
  output: { format: 'webp', quality: 0.9 },
  processing: { running: false, completed: 0, failed: 0, total: 0 },
  history: { past: [], future: [] },
};

export type BatchStickerAction =
  | { type: 'ADD_IMAGES'; images: BatchImage[] }
  | { type: 'CLEAR_IMAGES' }
  | { type: 'SET_PREVIEW_INDEX'; index: number }
  | { type: 'ADD_LAYER'; layer: StickerLayer }
  | { type: 'REMOVE_LAYER'; layerId: string }
  | { type: 'SELECT_LAYER'; layerId: string | null }
  | { type: 'MOVE_LAYER'; layerId: string; direction: 'up' | 'down' }
  | { type: 'COMMIT_LAYER_TRANSFORM'; layerId: string; transform: StickerTransform }
  | { type: 'APPLY_LAYERS'; layers: StickerLayer[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_OUTPUT_QUALITY'; quality: number }
  | { type: 'SET_PROCESSING'; processing: Partial<ProcessingState> }
  | { type: 'SET_IMAGE_STATUS'; imageId: string; status: BatchImage['status']; error?: string }
  | { type: 'SET_IMAGE_DIMENSIONS'; imageId: string; width: number; height: number };

function cloneLayers(layers: StickerLayer[]): StickerLayer[] {
  return layers.map((l) => ({ ...l, transform: { ...l.transform }, asset: { ...l.asset } }));
}

/** Pushes the CURRENT layers onto history.past before applying a new layers array; clears future. */
function withHistoryCommit(state: BatchState, nextLayers: StickerLayer[]): BatchState {
  return {
    ...state,
    layers: nextLayers,
    history: {
      past: [...state.history.past, cloneLayers(state.layers)],
      future: [],
    },
  };
}

export function batchStickerReducer(state: BatchState, action: BatchStickerAction): BatchState {
  switch (action.type) {
    case 'ADD_IMAGES':
      return { ...state, images: [...state.images, ...action.images] };

    case 'CLEAR_IMAGES':
      return { ...state, images: [], previewIndex: 0 };

    case 'SET_PREVIEW_INDEX':
      return { ...state, previewIndex: action.index };

    // Structural layer changes (add/remove/reorder) are not undo-tracked —
    // only committed transform edits and preset applies are (see §12 of
    // the design spec). This keeps the undo stack meaningful: it always
    // means "the sticker moved/resized/rotated/faded", never "a layer
    // appeared or disappeared".
    case 'ADD_LAYER': {
      const maxZ = state.layers.reduce((max, l) => Math.max(max, l.zIndex), -1);
      const layer = { ...action.layer, zIndex: maxZ + 1 };
      return { ...state, layers: [...state.layers, layer], selectedLayerId: layer.id };
    }

    case 'REMOVE_LAYER': {
      const nextLayers = state.layers.filter((l) => l.id !== action.layerId);
      return {
        ...state,
        layers: nextLayers,
        selectedLayerId: state.selectedLayerId === action.layerId ? null : state.selectedLayerId,
      };
    }

    case 'SELECT_LAYER':
      return { ...state, selectedLayerId: action.layerId };

    case 'MOVE_LAYER': {
      const sorted = [...state.layers].sort((a, b) => a.zIndex - b.zIndex);
      const idx = sorted.findIndex((l) => l.id === action.layerId);
      const swapWith = action.direction === 'up' ? idx + 1 : idx - 1;
      if (idx === -1 || swapWith < 0 || swapWith >= sorted.length) return state;

      const a = sorted[idx];
      const b = sorted[swapWith];
      const nextLayers = state.layers.map((l) => {
        if (l.id === a.id) return { ...l, zIndex: b.zIndex };
        if (l.id === b.id) return { ...l, zIndex: a.zIndex };
        return l;
      });
      return { ...state, layers: nextLayers };
    }

    case 'COMMIT_LAYER_TRANSFORM': {
      const nextLayers = state.layers.map((l) =>
        l.id === action.layerId ? { ...l, transform: action.transform } : l,
      );
      return withHistoryCommit(state, nextLayers);
    }

    case 'APPLY_LAYERS':
      return withHistoryCommit(state, action.layers);

    case 'UNDO': {
      if (state.history.past.length === 0) return state;
      const past = [...state.history.past];
      const previous = past.pop()!;
      return {
        ...state,
        layers: previous,
        history: { past, future: [...state.history.future, cloneLayers(state.layers)] },
      };
    }

    case 'REDO': {
      if (state.history.future.length === 0) return state;
      const future = [...state.history.future];
      const next = future.pop()!;
      return {
        ...state,
        layers: next,
        history: { past: [...state.history.past, cloneLayers(state.layers)], future },
      };
    }

    case 'SET_OUTPUT_QUALITY':
      return { ...state, output: { ...state.output, quality: action.quality } };

    case 'SET_PROCESSING':
      return { ...state, processing: { ...state.processing, ...action.processing } };

    case 'SET_IMAGE_STATUS':
      return {
        ...state,
        images: state.images.map((img) =>
          img.id === action.imageId ? { ...img, status: action.status, error: action.error } : img,
        ),
      };

    case 'SET_IMAGE_DIMENSIONS':
      return {
        ...state,
        images: state.images.map((img) =>
          img.id === action.imageId ? { ...img, width: action.width, height: action.height } : img,
        ),
      };

    default:
      return state;
  }
}

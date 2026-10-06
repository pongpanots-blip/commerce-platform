export interface StickerTransform {
  /** 0–1, normalized to image width, left edge of the unrotated bbox */
  x: number;
  /** 0–1, normalized to image height, top edge of the unrotated bbox */
  y: number;
  /** 0–1, normalized to image width */
  width: number;
  /** 0–1, normalized to image height */
  height: number;
  /** 0–1 */
  opacity: number;
  /** degrees, 0–360, rotation about the bbox center */
  rotation: number;
}

export interface StickerAsset {
  file: File;
  filename: string;
  width: number;
  height: number;
  aspectRatio: number;
}

export interface StickerLayer {
  id: string;
  asset: StickerAsset;
  transform: StickerTransform;
  /** paint order, ascending */
  zIndex: number;
  lockAspectRatio: boolean;
}

export interface StickerPresetLayer {
  transform: StickerTransform;
  assetFilename: string;
}

export interface StickerPreset {
  id: string;
  name: string;
  layers: StickerPresetLayer[];
}

export type BatchImageStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface BatchImage {
  id: string;
  file: File;
  filename: string;
  width?: number;
  height?: number;
  status: BatchImageStatus;
  error?: string;
}

export interface OutputSettings {
  format: 'webp';
  /** 0–1 internally; UI shows 1–100 */
  quality: number;
}

export interface ProcessingState {
  running: boolean;
  completed: number;
  failed: number;
  total: number;
  currentFile?: string;
}

export interface BatchStickerHistory {
  past: StickerLayer[][];
  future: StickerLayer[][];
}

export interface BatchState {
  images: BatchImage[];
  previewIndex: number;
  layers: StickerLayer[];
  selectedLayerId: string | null;
  output: OutputSettings;
  processing: ProcessingState;
  history: BatchStickerHistory;
}

/** A real pixel rectangle plus rotation, ready to draw. */
export interface StickerRect {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  /** radians, ready for ctx.rotate */
  rotationRadians: number;
  opacity: number;
}

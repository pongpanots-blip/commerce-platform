import type { BatchImage } from '../../../types/batch-sticker';

export type ResolutionCheckResult =
  | { status: 'pending' }
  | { status: 'consistent'; width: number; height: number }
  | { status: 'mixed' };

/**
 * Scans already-resolved image dimensions for consistency. Never blocks
 * processing either way — mixed resolutions work correctly since sticker
 * position is normalized — this is purely informational for the admin.
 */
export function checkResolutionConsistency(images: BatchImage[]): ResolutionCheckResult {
  if (images.length === 0) return { status: 'pending' };
  if (images.some((img) => img.width === undefined || img.height === undefined)) return { status: 'pending' };

  const first = images[0];
  const mixed = images.some((img) => img.width !== first.width || img.height !== first.height);
  if (mixed) return { status: 'mixed' };

  return { status: 'consistent', width: first.width!, height: first.height! };
}

/** Encodes a canvas to a WebP Blob, working with both Offscreen and regular canvases. */
export function encodeCanvasToWebp(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality });
  }

  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas failed to encode to WebP'))),
      'image/webp',
      quality,
    );
  });
}

/** True when the runtime can run the worker + OffscreenCanvas pipeline. */
export function supportsWorkerPipeline(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof OffscreenCanvas.prototype.convertToBlob === 'function'
  );
}

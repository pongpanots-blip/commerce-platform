export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/**
 * Decodes a File into an ImageBitmap plus its natural dimensions.
 * Used both for the interactive preview and for the "scan all image
 * resolutions" check — never for the whole lot at once (see spec §16 on
 * memory management: only the current preview + in-flight batch jobs are
 * decoded).
 */
export async function decodeImage(file: File): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/** Reads just width/height without keeping a decoded bitmap around. */
export async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}

const ACCEPTED_SOURCE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ACCEPTED_STICKER_TYPES = ['image/png', 'image/webp'];

export function isAcceptedSourceImage(file: File): boolean {
  return ACCEPTED_SOURCE_TYPES.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
}

export function isAcceptedStickerImage(file: File): boolean {
  return ACCEPTED_STICKER_TYPES.includes(file.type) || /\.(png|webp)$/i.test(file.name);
}

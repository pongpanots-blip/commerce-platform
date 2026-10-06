export interface ContainRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computes where the image actually renders inside a container under
 * `object-fit: contain` semantics — the preview must map screen
 * coordinates against THIS rect, not the full container, since a
 * mixed-aspect-ratio image is letterboxed within the preview area.
 */
export function computeContainRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): ContainRect {
  const containerRatio = containerWidth / containerHeight;
  const imageRatio = imageWidth / imageHeight;

  if (imageRatio > containerRatio) {
    const width = containerWidth;
    const height = width / imageRatio;
    return { x: 0, y: (containerHeight - height) / 2, width, height };
  }

  const height = containerHeight;
  const width = height * imageRatio;
  return { x: (containerWidth - width) / 2, y: 0, width, height };
}

/** Converts a screen-space point (relative to the container) to a 0–1 normalized image coordinate. */
export function screenPointToNormalized(
  screenX: number,
  screenY: number,
  containRect: ContainRect,
): { x: number; y: number } {
  return {
    x: (screenX - containRect.x) / containRect.width,
    y: (screenY - containRect.y) / containRect.height,
  };
}

/** Converts a 0–1 normalized image coordinate to a screen-space point (relative to the container). */
export function normalizedPointToScreen(
  normalizedX: number,
  normalizedY: number,
  containRect: ContainRect,
): { x: number; y: number } {
  return {
    x: containRect.x + normalizedX * containRect.width,
    y: containRect.y + normalizedY * containRect.height,
  };
}

/** Replaces (or adds) the extension, e.g. "product-red.jpg" -> "product-red.webp". */
export function toWebpFilename(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot === -1 ? filename : filename.slice(0, lastDot);
  return `${base}.webp`;
}

/**
 * Converts every source filename to its .webp output name, resolving
 * collisions (e.g. "image.jpg" and "image.png" both becoming "image.webp")
 * with an incrementing "_2", "_3", ... suffix. Resolved against the full
 * list at once so a generated suffix can never collide with a name a
 * later source file would also produce.
 */
export function resolveOutputFilenames(sourceFilenames: string[]): string[] {
  const used = new Set<string>();
  const result: string[] = [];

  for (const source of sourceFilenames) {
    const desired = toWebpFilename(source);
    let candidate = desired;

    if (used.has(candidate)) {
      const lastDot = desired.lastIndexOf('.');
      const base = lastDot === -1 ? desired : desired.slice(0, lastDot);
      const ext = lastDot === -1 ? '' : desired.slice(lastDot);
      let n = 2;
      candidate = `${base}_${n}${ext}`;
      while (used.has(candidate)) {
        n += 1;
        candidate = `${base}_${n}${ext}`;
      }
    }

    used.add(candidate);
    result.push(candidate);
  }

  return result;
}

import JSZip from 'jszip';
import { resolveOutputFilenames } from './filenames';

export interface ZipEntry {
  filename: string;
  blob: Blob;
}

/**
 * Blob.prototype.arrayBuffer isn't implemented in every runtime this code
 * needs to run in (notably jsdom under Vitest, whose Blob/Response
 * round-trip does not reliably preserve bytes); FileReader is universally
 * supported and gives correct bytes in both real browsers and jsdom.
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Builds the raw ZIP bytes for a set of entries, with collision-safe
 * .webp filenames resolved across the whole batch at once. Kept separate
 * from the File-wrapping step so callers (and tests) can work with the
 * buffer directly.
 */
export async function buildZipBuffer(entries: ZipEntry[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const outputNames = resolveOutputFilenames(entries.map((e) => e.filename));

  await Promise.all(
    entries.map(async (entry, i) => {
      const buffer = await blobToArrayBuffer(entry.blob);
      zip.file(outputNames[i], buffer);
    }),
  );

  return zip.generateAsync({ type: 'arraybuffer' });
}

/** Bundles processed image blobs into a single downloadable ZIP file. */
export async function createZip(entries: ZipEntry[], zipName = 'LOT_OUTPUT.zip'): Promise<File> {
  const buffer = await buildZipBuffer(entries);
  return new File([buffer], zipName, { type: 'application/zip' });
}

/** Triggers a browser download of the file without navigating away. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

import { useRef, useState } from 'react';
import { isAcceptedSourceImage } from '../../lib/batch-sticker/image/decodeImage';
import type { BatchImage } from '../../types/batch-sticker';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const LARGE_LOT_WARNING_THRESHOLD = 800;
const LARGE_FILE_WARNING_MB = 15;

function toBatchImages(files: File[]): BatchImage[] {
  return files.filter(isAcceptedSourceImage).map((file) => ({
    id: crypto.randomUUID(),
    file,
    filename: file.name,
    status: 'pending',
  }));
}

export function BatchUploader({
  imageCount,
  onImagesAdded,
}: {
  imageCount: number;
  onImagesAdded: (images: BatchImage[]) => void;
}) {
  __useUiLocale();
  const [isDragActive, setIsDragActive] = useState(false);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const images = toBatchImages(Array.from(fileList));
    if (images.length > 0) onImagesAdded(images);
  }

  const hasLargeFile = (fileList: FileList | null) =>
    fileList && Array.from(fileList).some((f) => f.size > LARGE_FILE_WARNING_MB * 1024 * 1024);

  const [warning, setWarning] = useState<string | null>(null);

  function handleSelected(fileList: FileList | null) {
    if (!fileList) return;
    if (fileList.length + imageCount > LARGE_LOT_WARNING_THRESHOLD || hasLargeFile(fileList)) {
      setWarning(__uiMessage("This lot contains very large images or a very large image count and may use significant memory."));
    } else {
      setWarning(null);
    }
    addFiles(fileList);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          onClick={() => filesInputRef.current?.click()}
        >
          {__uiText("Select Images")}</button>
        <button
          type="button"
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          onClick={() => folderInputRef.current?.click()}
        >
          {__uiText("Select Folder")}</button>
      </div>

      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          handleSelected(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error non-standard attribute, supported by Chromium/Firefox for folder selection
        webkitdirectory=""
        className="hidden"
        onChange={(e) => {
          handleSelected(e.target.files);
          e.target.value = '';
        }}
      />

      <div
        className={`rounded-xl border-2 border-dashed p-6 text-center text-sm transition-colors ${
          isDragActive ? 'border-primary bg-primary-soft' : 'border-gray-300 bg-gray-50 text-gray-500'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragActive(false);
          handleSelected(e.dataTransfer.files);
        }}
      >
        {__uiText("Drop your image lot here")}<br />
        <span className="text-xs text-gray-400">{__uiText("JPG / PNG / WebP")}</span>
      </div>

      {warning && <p className="text-sm text-amber-600">⚠ {warning}</p>}

      {imageCount > 0 ? (
        <p className="text-sm text-gray-600">{imageCount} {__uiText(" images loaded")}</p>
      ) : (
        <p className="text-sm text-gray-400">{__uiText("Drop an image lot, or select images/folder above.")}</p>
      )}
    </div>
  );
}

export default BatchUploader;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data

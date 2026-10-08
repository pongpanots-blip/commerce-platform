import type { BatchImage } from '../../types/batch-sticker';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageInfo({ image }: { image: BatchImage | undefined }) {
  __useUiLocale();
  if (!image) return null;

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
      <span>
        <span className="text-gray-400">{__uiText("Filename")}</span> {image.filename}
      </span>
      {image.width && image.height && (
        <span>
          <span className="text-gray-400">{__uiText("Resolution")}</span> {image.width} × {image.height}
        </span>
      )}
      <span>
        <span className="text-gray-400">{__uiText("Size")}</span> {formatFileSize(image.file.size)}
      </span>
    </div>
  );
}

export default ImageInfo;

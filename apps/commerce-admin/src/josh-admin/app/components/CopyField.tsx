import { useState } from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function CopyField({ label, value }: { label: string; value: string }) {
  __useUiLocale();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 break-all text-xs text-gray-800">{value}</code>
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
        >
          {copied ? __uiText("คัดลอกแล้ว") : __uiText("คัดลอก")}
        </button>
      </div>
    </div>
  );
}

export default CopyField;

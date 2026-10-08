import React from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
interface DateTimeRangeProps {
  /** `YYYY-MM-DDTHH:mm` in Asia/Bangkok (see `toBangkokInputValue` in @josh/shared-api) */
  startValue: string;
  endValue: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Date + time range typed in Thai time. Convert with `fromBangkokInputValue` before sending. */
export function DateTimeRangeInput({
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  disabled = false,
  className = '',
}: DateTimeRangeProps) {
  __useUiLocale();
  const startId = React.useId();
  const endId = React.useId();
  const field = 'text-xs text-gray-700 focus:outline-none cursor-pointer bg-transparent disabled:cursor-not-allowed';
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-sm ${className}`}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={startId} className="pl-1 text-xs font-medium text-gray-400">{__uiText("เริ่ม:")}</label>
        <input id={startId} type="datetime-local" value={startValue} disabled={disabled}
          onChange={(e) => onStartChange(e.target.value)} className={field} />
      </div>
      <span className="text-xs text-gray-300">─</span>
      <div className="flex items-center gap-1.5">
        <label htmlFor={endId} className="text-xs font-medium text-gray-400">{__uiText("ถึง:")}</label>
        <input id={endId} type="datetime-local" value={endValue} min={startValue} disabled={disabled}
          onChange={(e) => onEndChange(e.target.value)} className={field} />
      </div>
      <span className="text-[11px] text-gray-400">{__uiText("เวลาไทย (GMT+7)")}</span>
    </div>
  );
}

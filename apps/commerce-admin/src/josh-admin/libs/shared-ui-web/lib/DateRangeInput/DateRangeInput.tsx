import React from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
interface DateRangeProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  className?: string;
  label?: string;
}

export function DateRangeInput({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  className = '',
  label
}: DateRangeProps) {
  __useUiLocale();
  const startId = React.useId();
  const endId = React.useId();

  const dateRangeField = (
    <div className={`flex min-w-0 max-w-full flex-col gap-2 bg-surface-container-lowest border border-secondary-container px-3 py-2.5 rounded-lg sm:flex-row sm:items-center ${className}`}>

      {/* วันที่เริ่มต้น */}
      <div className="flex items-center gap-1.5">
        <label htmlFor={startId} className="text-xs text-gray-400 font-medium pl-1">{__uiText("เริ่ม:")}</label>
        <input
          id={startId}
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className="text-xs text-gray-700 focus:outline-none cursor-pointer bg-transparent"
        />
      </div>

      {/* เส้นแบ่งกลาง */}
      <span className="hidden text-gray-300 text-xs sm:inline">─</span>

      {/* วันที่สิ้นสุด */}
      <div className="flex items-center gap-1.5">
        <label htmlFor={endId} className="text-xs text-gray-400 font-medium">{__uiText("ถึง:")}</label>
        <input
          id={endId}
          type="date"
          value={endDate}
          onChange={(e) => onEndDateChange(e.target.value)}
          // ตั้งค่าไม่ให้เลือกวันที่ย้อนศรเกินวันเริ่มต้น
          min={startDate}
          className="text-xs text-gray-700 focus:outline-none cursor-pointer bg-transparent"
        />
      </div>

    </div>
  );

  if (!label) {
    return dateRangeField;
  }

  return (
    <div className="inline-flex min-w-0 max-w-full flex-col">
      <label htmlFor={startId} className="mb-1 block text-sm text-gray-600">{label}</label>
      {dateRangeField}
    </div>
  );
}

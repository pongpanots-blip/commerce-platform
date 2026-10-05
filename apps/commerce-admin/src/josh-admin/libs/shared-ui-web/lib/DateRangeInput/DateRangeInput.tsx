import React from 'react';

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
  const startId = React.useId();
  const endId = React.useId();

  const dateRangeField = (
    <div className={`flex items-center gap-2 bg-white border border-gray-200 px-3 py-2.5 rounded-lg shadow-sm ${className}`}>

      {/* วันที่เริ่มต้น */}
      <div className="flex items-center gap-1.5">
        <label htmlFor={startId} className="text-xs text-gray-400 font-medium pl-1">เริ่ม:</label>
        <input
          id={startId}
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className="text-xs text-gray-700 focus:outline-none cursor-pointer bg-transparent"
        />
      </div>

      {/* เส้นแบ่งกลาง */}
      <span className="text-gray-300 text-xs">─</span>

      {/* วันที่สิ้นสุด */}
      <div className="flex items-center gap-1.5">
        <label htmlFor={endId} className="text-xs text-gray-400 font-medium">ถึง:</label>
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
    <div className="inline-flex flex-col">
      <label htmlFor={startId} className="mb-1 block text-sm text-gray-600">{label}</label>
      {dateRangeField}
    </div>
  );
}
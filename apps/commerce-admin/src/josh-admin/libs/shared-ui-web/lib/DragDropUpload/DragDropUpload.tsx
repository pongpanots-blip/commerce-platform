import React, { useState, useRef, useId } from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
interface DragDropUploadProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  maxSizeMB?: number;
}

export const DragDropUpload: React.FC<DragDropUploadProps> = ({
  onFileSelect,
  accept = "image/*,application/pdf",
  maxSizeMB = 5
}) => {
  __useUiLocale();
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captionId = useId();

  // 🎯 จังหวะที่ลากไฟล์เข้ามาในเขตพื้นที่
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  // 🎯 จังหวะที่ "ปล่อยเมาส์ลากวางไฟล์ (Drop)"
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndProcessFile(e.dataTransfer.files[0]);
    }
  };

  // 🎯 จังหวะที่ "คลิกเลือกไฟล์ธรรมดา (Pick File)"
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndProcessFile(e.target.files[0]);
    }
  };

  // ตรวจสอบขนาดและส่งไฟล์ออกไปให้หน้าหลักใช้งาน
  const validateAndProcessFile = (file: File) => {
    if (file.size > maxSizeMB * 1024 * 1024) {
      alert(__uiText("ไฟล์ใหญ่เกินไป! ขนาดต้องไม่เกิน {0}MB", {"0": maxSizeMB}));
      return;
    }
    onFileSelect(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
        isDragActive
          ? "border-primary bg-primary/10"
          : "border-gray-300 hover:border-primary-light bg-gray-50 hover:bg-gray-100"
      }`}
      onClick={onButtonClick}
    >
      {/* Input ซ่อนอยู่ข้างหลังเพื่อทำหน้าที่เลือกไฟล์เวลากดคลิก */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={handleFileChange}
        aria-labelledby={captionId}
      />

      <div className="flex flex-col items-center justify-center space-y-3">
        {/* ไอคอน Cloud Upload */}
        <svg className={`w-12 h-12 ${isDragActive ? "text-primary animate-bounce" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>

        <p id={captionId} className="text-sm text-gray-600">
          <span className="font-semibold text-primary hover:underline">{__uiText("คลิกเพื่อเลือกไฟล์")}</span> {__uiText(" หรือลากไฟล์มาวางที่นี่")}</p>
        <p className="text-xs text-gray-400">
          {__uiText("รองรับไฟล์ตามประเภทที่กำหนด (สูงสุด ")}{maxSizeMB}{__uiText("MB)")}</p>
      </div>
    </div>
  );
};
// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { bulkUploadProductImages } from '@josh/shared-api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { useQuery } from '@tanstack/react-query';
import {
  getBulkUploadLogs,
  pruneSupersededBulkUploadImages,
  type BulkUploadLogItem,
} from '@josh/shared-api';
import { Table, type TableColumn } from '@josh/shared-ui-web';
import {
  bulkUploadLogStatusLabel,
  classifyStagedFiles,
  extractBulkUploadResult,
  FAIL_REASON_TH,
  matchBatchResults,
  MAX_FILE_SIZE_BYTES,
  type BulkUploadFailReason,
  type BulkUploadMode,
} from './bulk-image-upload.helpers';

// ---- constants (per docs/superpowers/plans/2026-08-17-sku-image-dropzone.html) ----
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const MAX_STAGED_FILES = 500;
const BATCH_SIZE = 10;
const VISIBLE_ROWS_STEP = 50;
const HISTORY_LIMIT = 20;

type FailReason = BulkUploadFailReason;

type RowStatus = 'ready' | 'rejected' | 'queued' | 'uploading' | 'done' | 'failed';

type StagedRow = {
  key: string;
  file: File;
  sku: string | null;
  sequence: number | null;
  status: RowStatus;
  reason?: FailReason;
};

/**
 * Re-runs classification over every row that has not been sent yet. Needed as
 * its own pass (not just at drop time) because switching mode changes which
 * files are valid — replace rejects files with no `_<n>` and duplicate slots.
 */
function reclassifyRows(rows: StagedRow[], mode: BulkUploadMode): StagedRow[] {
  const pending = rows.filter((row) => row.status === 'ready' || row.status === 'rejected');
  const classified = classifyStagedFiles(
    pending.map((row) => ({ name: row.file.name, type: row.file.type, size: row.file.size })),
    mode,
  );
  const byKey = new Map(pending.map((row, index) => [row.key, classified[index]]));

  return rows.map((row) => {
    const next = byKey.get(row.key);
    if (!next) return row;
    return {
      ...row,
      sku: next.sku,
      sequence: next.sequence,
      status: next.status,
      reason: next.reason,
    };
  });
}

/** Recursively walks a dropped FileSystemEntry tree and flattens it into a File[]. */
async function readEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    return new Promise<File[]>((resolve) => {
      fileEntry.file((file) => resolve([file]), () => resolve([]));
    });
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const entries: FileSystemEntry[] = await new Promise((resolve) => {
      const all: FileSystemEntry[] = [];
      const readBatch = () => {
        reader.readEntries((batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readBatch();
        }, () => resolve(all));
      };
      readBatch();
    });
    const nested = await Promise.all(entries.map((child) => readEntry(child)));
    return nested.flat();
  }
  return [];
}

async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (entries.length > 0) {
    const nested = await Promise.all(entries.map((entry) => readEntry(entry)));
    return nested.flat();
  }
  // Fallback: browsers without the entries API — plain file drop still works.
  return Array.from(dataTransfer.files ?? []);
}

type PageState = 'idle' | 'staged' | 'uploading' | 'results';

const HISTORY_MODE_TH: Record<BulkUploadLogItem['mode'], string> = {
  append: 'เพิ่มต่อท้าย',
  replace: 'แทนที่ตามลำดับ',
  restore: 'กู้คืน',
};

type HistoryRow = BulkUploadLogItem & { isNewBatch: boolean };

const historyColumns: TableColumn<HistoryRow>[] = [
  {
    key: 'createdAt',
    get label(){return __uiText("เวลา");},
    render: (value: string, row) => (
      <span className={row.isNewBatch ? 'font-semibold text-gray-800' : 'text-gray-600'}>
        {new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), { dateStyle: 'short', timeStyle: 'short' })}
      </span>
    ),
  },
  {
    key: 'mode',
    get label(){return __uiText("โหมด");},
    render: (value: BulkUploadLogItem['mode']) => HISTORY_MODE_TH[value] ?? value,
  },
  {
    key: 'filename',
    get label(){return __uiText("ไฟล์");},
    render: (value: string) => <span className="font-mono text-xs">{value}</span>,
  },
  {
    key: 'sku',
    get label(){return __uiText("SKU");},
    render: (value: string) => <span className="font-mono text-xs">{value}</span>,
  },
  {
    key: 'status',
    get label(){return __uiText("สถานะ");},
    render: (value: string) => (
      <span
        className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${
          value === 'ok' ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
        }`}
      >
        {bulkUploadLogStatusLabel(value)}
      </span>
    ),
  },
  {
    key: 'url',
    get label(){return __uiText("รูป");},
    render: (value: string | null) =>
      value ? (
        <img src={value} alt="" className="w-9 h-9 rounded-md object-cover bg-gray-100" />
      ) : (
        <span className="text-xs text-gray-400">—</span>
      ),
  },
];

const BulkImageUploadPage = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [rows, setRows] = useState<StagedRow[]>([]);
  const [pageState, setPageState] = useState<PageState>('idle');
  const [visibleCount, setVisibleCount] = useState(VISIBLE_ROWS_STEP);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [isDragActive, setIsDragActive] = useState(false);
  const [mode, setMode] = useState<BulkUploadMode>('append');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [historyPage, setHistoryPage] = useState(1);
  const {
    data: historyResponse,
    isLoading: historyLoading,
    isError: historyIsError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['bulk-upload-logs', historyPage],
    queryFn: async () => {
      const response = await getBulkUploadLogs({ page: historyPage, limit: HISTORY_LIMIT });
      return response.data?.data as {
        items: BulkUploadLogItem[];
        total: number;
        page: number;
        limit: number;
      };
    },
  });
  const historyItems = historyResponse?.items ?? [];

  const [pruning, setPruning] = useState(false);
  // Dry run first so the admin sees the count before anything leaves S3 — this
  // delete is permanent and can span every product at once.
  const runPrune = async () => {
    setPruning(true);
    try {
      const preview = await pruneSupersededBulkUploadImages(true);
      const candidates = preview.data?.data?.candidates ?? 0;
      if (candidates === 0) {
        window.alert(__uiText("ไม่มีรูปเก่าที่ต้องลบ"));
        return;
      }
      if (
        !window.confirm(
          __uiText("พบรูปเก่าที่กู้คืนไม่ได้แล้ว {0} ไฟล์\nลบออกจาก S3 ถาวร? ย้อนกลับไม่ได้", {"0": candidates}),
        )
      ) {
        return;
      }
      const result = await pruneSupersededBulkUploadImages(false);
      window.alert(result.data?.message ?? __uiText("ล้างรูปเก่าเรียบร้อย"));
      refetchHistory();
    } catch {
      window.alert(__uiText("ล้างรูปเก่าไม่สำเร็จ"));
    } finally {
      setPruning(false);
    }
  };

  // A left border marks the first row of a new batch — cheap to compute since
  // logs already arrive newest-first, batch-contiguous.
  const historyRows = useMemo(
    () =>
      historyItems.map((item, i) => ({
        ...item,
        isNewBatch: i === 0 || item.batchId !== historyItems[i - 1].batchId,
      })),
    [historyItems],
  );

  // Object URLs are cheap references (unlike data URLs) — safe to keep one per
  // staged file even at 500 files. A staged row's `.file` never changes once
  // added (only `.status` does), so URLs are created once per row and only
  // revoked when that row leaves `rows` entirely, or on unmount.
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const [, forceThumbRerender] = useState(0);
  useEffect(() => {
    const cache = objectUrlsRef.current;
    let created = false;
    rows.forEach((row) => {
      if (!cache.has(row.key)) {
        cache.set(row.key, URL.createObjectURL(row.file));
        created = true;
      }
    });
    const activeKeys = new Set(rows.map((row) => row.key));
    cache.forEach((url, key) => {
      if (!activeKeys.has(key)) {
        URL.revokeObjectURL(url);
        cache.delete(key);
      }
    });
    if (created) forceThumbRerender((n) => n + 1);
  }, [rows]);
  useEffect(() => {
    const cache = objectUrlsRef.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);
  const thumbUrl = useCallback((key: string) => objectUrlsRef.current.get(key), []);

  const readyRows = useMemo(() => rows.filter((r) => r.status === 'ready' || r.status === 'done' || r.status === 'queued' || r.status === 'uploading' || r.status === 'failed'), [rows]);
  const rejectedRows = useMemo(() => rows.filter((r) => r.status === 'rejected'), [rows]);
  const readyToSendCount = useMemo(() => rows.filter((r) => r.status === 'ready').length, [rows]);
  const doneRows = useMemo(() => rows.filter((r) => r.status === 'done'), [rows]);
  const failedRows = useMemo(() => rows.filter((r) => r.status === 'failed'), [rows]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      setRows((prev) => {
        const room = MAX_STAGED_FILES - prev.length;
        const toAdd = incoming.slice(0, Math.max(room, 0));
        const newRows: StagedRow[] = toAdd.map((file, i) => ({
          key: `${file.name}-${file.size}-${prev.length + i}-${Date.now()}`,
          file,
          sku: null,
          sequence: null,
          status: 'ready' as RowStatus,
        }));
        // Classify old + new together: a duplicate slot only shows up against
        // the files already staged.
        return reclassifyRows([...prev, ...newRows], mode);
      });
      setPageState('staged');
    },
    [mode],
  );

  const changeMode = (next: BulkUploadMode) => {
    setMode(next);
    setRows((prev) => reclassifyRows(prev, next));
  };

  const handleFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) addFiles(files);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    const files = await filesFromDataTransfer(e.dataTransfer);
    if (files.length) addFiles(files);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setIsDragActive(true);
    else if (e.type === 'dragleave') setIsDragActive(false);
  };

  const openFolderPicker = () => folderInputRef.current?.click();
  const openFilePicker = () => fileInputRef.current?.click();

  const clearAll = () => {
    setRows([]);
    setPageState('idle');
    setVisibleCount(VISIBLE_ROWS_STEP);
  };

  const startNewBatch = () => {
    clearAll();
  };

  const uploadInFlightRef = useRef(false);

  const runUpload = async (rowsToSend: StagedRow[]) => {
    if (rowsToSend.length === 0) return;
    // A double-click on "อัปโหลด" (or a fast repeat of "ลองอีกครั้ง") can fire
    // before the re-render that hides/disables the trigger commits — without
    // this guard that sends the same batch of files to the server twice,
    // duplicating every image in S3 and in product_media.
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setPageState('uploading');
    const keys = rowsToSend.map((r) => r.key);
    setRows((prev) => prev.map((r) => (keys.includes(r.key) ? { ...r, status: 'queued' as RowStatus } : r)));

    const batches: StagedRow[][] = [];
    for (let i = 0; i < rowsToSend.length; i += BATCH_SIZE) {
      batches.push(rowsToSend.slice(i, i + BATCH_SIZE));
    }
    setBatchProgress({ current: 0, total: batches.length });

    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      const batchKeys = batch.map((r) => r.key);
      setRows((prev) => prev.map((r) => (batchKeys.includes(r.key) ? { ...r, status: 'uploading' as RowStatus } : r)));

      const formData = new FormData();
      formData.append('mode', mode);
      batch.forEach((row) => formData.append('images', row.file, row.file.name));

      try {
        const { appended, failed } = extractBulkUploadResult(
          await bulkUploadProductImages(formData),
        );
        // Correlate once, outside setRows: React Strict Mode (dev) runs the
        // updater twice, and shifting queues inside it marked every success as
        // upload_failed on the second pass — even though S3/DB already wrote.
        const matched = matchBatchResults(
          batch.map((row) => ({ key: row.key, fileName: row.file.name })),
          appended,
          failed,
        );
        setRows((prev) =>
          prev.map((r) => {
            const result = matched.get(r.key);
            if (!result) return r;
            return { ...r, status: result.status, reason: result.reason };
          }),
        );
      } catch (error) {
        // eslint-disable-next-line no-console -- surfaces the real cause; the UI only shows a generic Thai message
        console.error(`bulk-upload batch ${i + 1}/${batches.length} threw`, error);
        setRows((prev) =>
          prev.map((r) => (batchKeys.includes(r.key) ? { ...r, status: 'failed' as RowStatus, reason: 'upload_failed' } : r)),
        );
      }

      setBatchProgress({ current: i + 1, total: batches.length });
    }

    uploadInFlightRef.current = false;
    setPageState('results');
    // Changing the page triggers react-query's own refetch (queryKey changed);
    // already on page 1, the key stays the same, so refetch explicitly.
    if (historyPage === 1) refetchHistory();
    else setHistoryPage(1);
  };

  const startUpload = () => {
    const toSend = rows.filter((r) => r.status === 'ready');
    runUpload(toSend);
  };

  const retryFailedOnly = () => {
    const toRetry = rows.filter((r) => r.status === 'failed');
    runUpload(toRetry);
  };

  const removeFailed = () => {
    const remaining = rows.filter((r) => r.status !== 'failed');
    setRows(remaining);
    setPageState((prev) => (remaining.length === 0 ? 'idle' : prev));
  };

  const allFailed = pageState === 'results' && doneRows.length === 0 && failedRows.length > 0;
  const dominantFailReason = useMemo<FailReason | null>(() => {
    if (failedRows.length === 0) return null;
    const counts = new Map<FailReason, number>();
    failedRows.forEach((r) => {
      const reason = r.reason ?? 'upload_failed';
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    });
    let top: FailReason | null = null;
    let topCount = 0;
    counts.forEach((count, reason) => {
      if (count > topCount) {
        top = reason;
        topCount = count;
      }
    });
    return top;
  }, [failedRows]);
  const progressPct = batchProgress.total > 0 ? Math.round((batchProgress.current / batchProgress.total) * 100) : 0;
  const uploadedFilesCount = readyRows.filter((r) => r.status === 'done' || r.status === 'failed').length;
  const totalToSendForProgress = readyRows.length;

  return (
    <div className="cp-management-page">
      <button
        type="button"
        onClick={() => navigate(ADMIN_ROUTES.products)}
        className="text-sm text-gray-500 hover:text-gray-800 mb-2"
      >
        {__uiText("← กลับ")}</button>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{__uiText("อัปโหลดรูปสินค้าแบบชุด")}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {mode === 'replace'
            ? __uiText("ลากรูปหลายไฟล์มาวาง ระบบจะจับคู่รูปกับ SKU จากชื่อไฟล์ แล้วแทนที่รูปตามลำดับที่ระบุในชื่อไฟล์ (รูปเดิมที่ลำดับนั้นถูกทับ)")
            : __uiText("ลากรูปหลายไฟล์มาวาง ระบบจะจับคู่รูปกับ SKU จากชื่อไฟล์ แล้วเพิ่มต่อท้ายแกลเลอรีเดิม (ไม่ลบ/ไม่แทนที่รูปเดิม)")}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-4">
        {pageState !== 'uploading' && pageState !== 'results' && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-gray-700">{__uiText("โหมด")}</span>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden" role="group">
              {(
                [
                  { value: 'append' as const, label: 'เพิ่มต่อท้าย' },
                  { value: 'replace' as const, label: 'แทนที่ตามลำดับ' },
                ]
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  onClick={() => changeMode(option.value)}
                  className={`px-3 py-1.5 text-xs font-semibold ${
                    mode === option.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {__uiText(option.label)}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500">
              {mode === 'replace'
                ? __uiText("JG001_2.jpg จะทับรูปที่ 2 ของ JG001 — ชื่อไฟล์ต้องมีลำดับ และห้ามซ้ำลำดับในชุดเดียวกัน")
                : __uiText("รูปทุกไฟล์ถูกเพิ่มต่อท้ายแกลเลอรีเดิม")}
            </span>
          </div>
        )}

        {pageState !== 'uploading' && pageState !== 'results' && (
          <>
            <div
              aria-label={__uiText("ลากไฟล์หรือโฟลเดอร์มาวาง หรือเลือกด้วยปุ่มด้านล่าง")}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl text-center transition-colors ${
                pageState === 'idle' ? 'p-10' : 'p-5'
              } ${isDragActive ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}
            >
              {pageState === 'idle' ? (
                <>
                  <strong className="block text-sm text-gray-900">{__uiText("ลากไฟล์หรือโฟลเดอร์รูปมาวางที่นี่")}</strong>
                  <span className="block text-xs text-gray-500 mt-1">{__uiText("หรือ")}</span>
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={openFolderPicker}
                      className="px-3.5 py-1.5 text-xs font-semibold text-blue-600 bg-white border border-gray-200 rounded-lg hover:border-blue-600"
                    >
                      {__uiText("เลือกโฟลเดอร์")}</button>
                    <button
                      type="button"
                      onClick={openFilePicker}
                      className="px-3.5 py-1.5 text-xs font-semibold text-blue-600 bg-white border border-gray-200 rounded-lg hover:border-blue-600"
                    >
                      {__uiText("เลือกไฟล์")}</button>
                  </div>
                  <div className="text-xs text-gray-500 mt-2.5">
                    {__uiText("สูงสุด ")}{MAX_STAGED_FILES} {__uiText(" ไฟล์ต่อครั้ง · ไฟล์ละไม่เกิน ")}{MAX_FILE_SIZE_BYTES / (1024 * 1024)} {__uiText(" MB · jpg, jpeg, png, gif, webp")}</div>
                </>
              ) : (
                <>
                  <strong className="block text-xs text-gray-900">
                    {__uiText("วางไฟล์เพิ่มได้ (เหลืออีก ")}{Math.max(MAX_STAGED_FILES - rows.length, 0)} {__uiText(" ไฟล์)")}</strong>
                  <div className="flex items-center justify-center gap-2 mt-2.5">
                    <button
                      type="button"
                      onClick={openFolderPicker}
                      className="px-3 py-1 text-xs font-semibold text-blue-600 bg-white border border-gray-200 rounded-lg hover:border-blue-600"
                    >
                      {__uiText("เลือกโฟลเดอร์")}</button>
                    <button
                      type="button"
                      onClick={openFilePicker}
                      className="px-3 py-1 text-xs font-semibold text-blue-600 bg-white border border-gray-200 rounded-lg hover:border-blue-600"
                    >
                      {__uiText("เลือกไฟล์")}</button>
                  </div>
                </>
              )}
              <input
                ref={folderInputRef}
                type="file"
                multiple
                aria-label={__uiText("เลือกโฟลเดอร์รูปภาพเพื่ออัปโหลด")}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                {...({ webkitdirectory: 'true', directory: 'true' } as any)}
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleFilesPicked}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                aria-label={__uiText("เลือกไฟล์รูปภาพเพื่ออัปโหลด")}
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleFilesPicked}
              />
            </div>

            {pageState === 'idle' && (
              <div className="bg-blue-50 border border-gray-200 rounded-lg p-3.5 text-xs text-gray-700">
                <h3 className="text-xs font-bold text-gray-900 mb-1.5">
                  {__uiText("ตั้งชื่อไฟล์ตามรูปแบบ ")}<code className="font-mono bg-white border border-gray-200 rounded px-1">{__uiText("sku_ลำดับ.นามสกุล")}</code> {__uiText(" — ระบบใช้ชื่อไฟล์จับคู่สินค้า")}</h3>
                <table className="mt-1">
                  <tbody>
                    <tr>
                      <td className="pr-3 py-0.5 font-mono text-xs">{__uiText("JG001_1.jpg")}</td>
                      <td className="py-0.5 text-xs">{__uiText("→ SKU ")}<b>{__uiText("JG001")}</b> {__uiText(" รูปที่ 1")}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 py-0.5 font-mono text-xs">{__uiText("JG001_2.jpg")}</td>
                      <td className="py-0.5 text-xs">{__uiText("→ SKU ")}<b>{__uiText("JG001")}</b> {__uiText(" รูปที่ 2")}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 py-0.5 font-mono text-xs">{__uiText("JG-001_2.png")}</td>
                      <td className="py-0.5 text-xs">
                        {__uiText("→ SKU ")}<b>{__uiText("JG-001")}</b> {__uiText(" (ขีดในรหัสได้ ระบบตัดเฉพาะ _ตัวเลขท้ายสุด)")}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 py-0.5 font-mono text-xs">{__uiText("JG002.webp")}</td>
                      <td className="py-0.5 text-xs">
                        {mode === 'replace' ? (
                          <>→ <b className="text-red-700">{__uiText("ถูกข้าม")}</b> {__uiText(" — โหมดแทนที่ต้องมีลำดับเสมอ")}</>
                        ) : (
                          <>{__uiText("→ SKU ")}<b>{__uiText("JG002")}</b> {__uiText(" (ไม่ใส่ลำดับก็ได้)")}</>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-1.5 text-gray-500">
                  {__uiText("ตัวพิมพ์ใหญ่/เล็กไม่มีผล · ไฟล์ที่จับคู่ SKU ไม่ได้จะถูกข้ามและแจ้งให้ทราบ")}{mode === 'replace' && __uiText(" · โหมดแทนที่: ลำดับในชื่อไฟล์คือรูปที่จะถูกทับ ถ้าลำดับนั้นยังว่างจะเพิ่มให้แทน")}
                </div>
              </div>
            )}
          </>
        )}

        {pageState === 'staged' && rows.length > 0 && (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mt-1">
              {rows.slice(0, visibleCount).map((row) => (
                <div
                  key={row.key}
                  className={`rounded-lg border p-1.5 flex flex-col gap-1 ${
                    row.status === 'rejected' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="relative aspect-square rounded-md bg-gray-100 overflow-hidden">
                    {thumbUrl(row.key) ? (
                      <img
                        src={thumbUrl(row.key)}
                        alt={row.file.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">…</div>
                    )}
                    <div
                      className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[10px] font-mono font-semibold text-white bg-black/60 truncate"
                      title={row.sku ?? undefined}
                    >
                      {row.sku ?? __uiText("— ไม่พบ SKU")}
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-gray-500 truncate" title={row.file.name}>
                    {row.file.name}
                  </div>
                  {row.status === 'ready' ? (
                    <span className="inline-block text-[10px] font-semibold rounded-full px-1.5 py-0.5 text-green-700 bg-green-50 self-start">
                      {mode === 'replace' ? __uiText("แทนที่รูปที่ {0}", {"0": row.sequence}) : __uiText("พร้อมอัปโหลด")}
                    </span>
                  ) : (
                    <>
                      <span className="inline-block text-[10px] font-semibold rounded-full px-1.5 py-0.5 text-red-700 bg-red-50 self-start">
                        {__uiText("ถูกข้าม")}</span>
                      <div className="text-[10px] text-red-700 leading-tight">
                        {row.reason ? FAIL_REASON_TH[row.reason] : ''}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            {rows.length > visibleCount && (
              <button
                type="button"
                onClick={() => setVisibleCount((v) => v + VISIBLE_ROWS_STEP)}
                className="text-xs text-blue-600 font-semibold self-start"
              >
                {__uiText("แสดงเพิ่ม (")}{rows.length - visibleCount} {__uiText(" รายการที่เหลือ)")}</button>
            )}

            <div className="flex items-center gap-2 flex-wrap mt-2">
              <button
                type="button"
                disabled={readyToSendCount === 0 || pageState !== 'staged'}
                onClick={startUpload}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {mode === 'replace' ? __uiText("แทนที่") : __uiText("อัปโหลด")} {readyToSendCount} {__uiText(" ไฟล์")}</button>
              <button
                type="button"
                onClick={clearAll}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 bg-white text-gray-700"
              >
                {__uiText("ล้างรายการ")}</button>
              <span className="text-xs text-gray-500 ml-auto">
                {__uiText("พร้อมอัปโหลด ")}{readyToSendCount} {__uiText(" · ถูกข้าม ")}{rejectedRows.length} {__uiText(" (ไฟล์ที่ถูกข้ามจะไม่ถูกส่ง)")}</span>
            </div>
          </>
        )}

        {pageState === 'uploading' && (
          <>
            <div className="flex items-baseline justify-between">
              <strong className="text-sm text-gray-900">
                {__uiText("กำลังอัปโหลดชุดที่ ")}{batchProgress.current}/{batchProgress.total} ({uploadedFilesCount}/{totalToSendForProgress} {__uiText(" ไฟล์)")}</strong>
              <span className="text-xs text-gray-500">{__uiText("อย่าปิดหน้านี้จนกว่าจะเสร็จ")}</span>
            </div>
            <div
              className="h-1.5 rounded-full bg-gray-200 overflow-hidden"
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full bg-blue-600 rounded-full transition-[width]" style={{ width: `${progressPct}%` }} />
            </div>

            <table className="w-full text-sm mt-2">
              <tbody>
                {readyRows.slice(0, visibleCount).map((row) => (
                  <tr key={row.key} className="border-b border-gray-50">
                    <td className="py-2 px-2.5">
                      {thumbUrl(row.key) ? (
                        <img
                          src={thumbUrl(row.key)}
                          alt={row.file.name}
                          className="w-9 h-9 rounded-md object-cover bg-gray-100"
                        />
                      ) : (
                        <span className="w-9 h-9 rounded-md bg-gray-200 inline-flex items-center justify-center text-[10px] text-gray-500" />
                      )}
                    </td>
                    <td className="py-2 px-2.5 font-mono text-xs">{row.file.name}</td>
                    <td className="py-2 px-2.5 font-mono text-xs">{row.sku ?? '—'}</td>
                    <td className="py-2 px-2.5">
                      {row.status === 'done' && (
                        <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 text-green-700 bg-green-50">{__uiText("สำเร็จ")}</span>
                      )}
                      {row.status === 'uploading' && (
                        <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 text-gray-500 bg-gray-50 border border-gray-200">
                          {__uiText("กำลังอัปโหลด…")}</span>
                      )}
                      {row.status === 'queued' && (
                        <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 text-gray-500 bg-gray-50 border border-gray-200">
                          {__uiText("รอคิว")}</span>
                      )}
                      {row.status === 'failed' && (
                        <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 text-red-700 bg-red-50">{__uiText("ไม่สำเร็จ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {readyRows.length > visibleCount && (
              <button
                type="button"
                onClick={() => setVisibleCount((v) => v + VISIBLE_ROWS_STEP)}
                className="text-xs text-blue-600 font-semibold self-start"
              >
                {__uiText("แสดงเพิ่ม (")}{readyRows.length - visibleCount} {__uiText(" รายการที่เหลือ)")}</button>
            )}

            <div className="mt-2">
              <button type="button" disabled className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white opacity-45 cursor-not-allowed">
                {__uiText("กำลังอัปโหลด…")}</button>
            </div>
          </>
        )}

        {pageState === 'results' && (
          <>
            <div className="flex gap-2 flex-wrap">
              {allFailed ? (
                <span className="text-sm font-semibold rounded-lg px-3 py-1.5 bg-red-50 text-red-700">
                  {__uiText("ไม่สำเร็จทั้งหมด — 0 จาก ")}{rows.length} {__uiText(" ไฟล์ถูก")}{mode === 'replace' ? __uiText("แทนที่") : __uiText("เพิ่ม")}
                </span>
              ) : (
                <>
                  <span className="text-sm font-semibold rounded-lg px-3 py-1.5 bg-green-50 text-green-700">
                    {mode === 'replace' ? __uiText("แทนที่รูปสำเร็จ") : __uiText("เพิ่มรูปสำเร็จ")} {doneRows.length} {__uiText(" ไฟล์")}</span>
                  {failedRows.length > 0 && (
                    <span className="text-sm font-semibold rounded-lg px-3 py-1.5 bg-red-50 text-red-700">
                      {__uiText("ไม่สำเร็จ ")}{failedRows.length} {__uiText(" ไฟล์")}</span>
                  )}
                </>
              )}
            </div>

            {allFailed && dominantFailReason === 'invalid_filename' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-800">
                <h3 className="text-xs font-bold mb-1.5">{__uiText("ทุกไฟล์อ่าน SKU ไม่ได้ — ปัญหาน่าจะอยู่ที่ชื่อไฟล์")}</h3>
                {__uiText("ระบบจับคู่รูปกับสินค้าจาก ")}<b>{__uiText("ชื่อไฟล์เท่านั้น")}</b> {__uiText(" ตัวอย่างจากชุดนี้:")}<div className="my-1.5">
                  <code className="font-mono bg-white border border-amber-200 rounded px-1">{failedRows[0]?.file.name}</code> {__uiText(" → อ่านไม่ได้ · ควรเป็น ")}<code className="font-mono bg-white border border-amber-200 rounded px-1">{__uiText("JG001_1.jpg")}</code>
                </div>
                {__uiText("เปลี่ยนชื่อไฟล์เป็น ")}<code className="font-mono bg-white border border-amber-200 rounded px-1">{__uiText("sku_ลำดับ.นามสกุล")}</code> {__uiText(" (เช่น")}{' '}
                <code className="font-mono bg-white border border-amber-200 rounded px-1">{__uiText("JG001_1.jpg")}</code>,{' '}
                <code className="font-mono bg-white border border-amber-200 rounded px-1">{__uiText("JG001_2.jpg")}</code>{__uiText(") แล้วลากมาวางใหม่")}</div>
            )}

            {allFailed && dominantFailReason === 'sku_not_found' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-800">
                <h3 className="text-xs font-bold mb-1.5">{__uiText("ทุกไฟล์ไม่พบ SKU ในระบบ")}</h3>
                {__uiText("ระบบอ่านชื่อไฟล์ได้ แต่ไม่พบรหัสสินค้าที่ตรงกันในระบบ ตัวอย่างจากชุดนี้:")}<div className="my-1.5">
                  <code className="font-mono bg-white border border-amber-200 rounded px-1">{failedRows[0]?.file.name}</code> {__uiText(" → SKU")}{' '}
                  <code className="font-mono bg-white border border-amber-200 rounded px-1">{failedRows[0]?.sku ?? '—'}</code> {__uiText(" ไม่พบในระบบ")}</div>
                {__uiText("ตรวจสอบว่ารหัสสินค้าตรงกับ SKU ในระบบ แล้วลองใหม่อีกครั้ง")}</div>
            )}

            {allFailed && dominantFailReason === 'upload_failed' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-800">
                <h3 className="text-xs font-bold mb-1.5">{__uiText("อัปโหลดขัดข้องทั้งหมด")}</h3>
                {__uiText("ไฟล์อ่าน SKU ได้ปกติ แต่การอัปโหลดล้มเหลว อาจเกิดจากปัญหาเครือข่ายหรือเซิร์ฟเวอร์ชั่วคราว ลองกด “ลองอีกครั้งเฉพาะไฟล์ที่ไม่สำเร็จ” ด้านล่าง")}</div>
            )}

            {allFailed && (dominantFailReason === 'file_too_large' || dominantFailReason === 'unsupported_type') && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-800">
                <h3 className="text-xs font-bold mb-1.5">
                  {dominantFailReason === 'file_too_large' ? __uiText("ไฟล์ใหญ่เกินกำหนดทั้งหมด") : __uiText("ชนิดไฟล์ไม่รองรับทั้งหมด")}
                </h3>
                {dominantFailReason === 'file_too_large'
                  ? __uiText("ไฟล์ในชุดนี้ใหญ่เกิน 5 MB — ย่อขนาดไฟล์แล้วลองใหม่")
                  : __uiText("ระบบรองรับเฉพาะไฟล์ jpg, jpeg, png, gif, webp — ตรวจสอบชนิดไฟล์แล้วลองใหม่")}
              </div>
            )}

            {failedRows.length > 0 && (
              <>
                <div className="text-sm font-bold text-red-700 mt-2">{__uiText("ไม่สำเร็จ (")}{failedRows.length})</div>
                <table className="w-full text-sm">
                  <tbody>
                    {failedRows.slice(0, visibleCount).map((row) => (
                      <tr key={row.key} className="border-b border-gray-50 bg-red-50">
                        <td className="py-2 px-2.5">
                          {thumbUrl(row.key) ? (
                            <img
                              src={thumbUrl(row.key)}
                              alt={row.file.name}
                              className="w-9 h-9 rounded-md object-cover bg-gray-100"
                            />
                          ) : (
                            <span className="w-9 h-9 rounded-md bg-gray-200 inline-flex items-center justify-center text-[10px] text-gray-500" />
                          )}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-xs">{row.file.name}</td>
                        <td className="py-2 px-2.5 font-mono text-xs">{row.sku ?? '—'}</td>
                        <td className="py-2 px-2.5">
                          <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 text-red-700 bg-red-50">{__uiText("ไม่สำเร็จ")}</span>
                          <div className="text-xs text-red-700 mt-0.5">{row.reason ? FAIL_REASON_TH[row.reason] : ''}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {failedRows.length > visibleCount && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((v) => v + VISIBLE_ROWS_STEP)}
                    className="text-xs text-blue-600 font-semibold self-start"
                  >
                    {__uiText("…อีก ")}{failedRows.length - visibleCount} {__uiText(" รายการ")}</button>
                )}
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={retryFailedOnly}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white"
                  >
                    {__uiText("ลองอีกครั้งเฉพาะไฟล์ที่ไม่สำเร็จ")}</button>
                  <button
                    type="button"
                    onClick={removeFailed}
                    className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 bg-white text-gray-700"
                  >
                    {__uiText("ลบไฟล์ที่ไม่สำเร็จออก")}</button>
                </div>
              </>
            )}

            {!allFailed && doneRows.length > 0 && (
              <>
                <div className="text-sm font-bold text-green-700 mt-2">{__uiText("สำเร็จ (")}{doneRows.length})</div>
                <table className="w-full text-sm">
                  <tbody>
                    {doneRows.slice(0, visibleCount).map((row) => (
                      <tr key={row.key} className="border-b border-gray-50">
                        <td className="py-2 px-2.5">
                          {thumbUrl(row.key) ? (
                            <img
                              src={thumbUrl(row.key)}
                              alt={row.file.name}
                              className="w-9 h-9 rounded-md object-cover bg-gray-100"
                            />
                          ) : (
                            <span className="w-9 h-9 rounded-md bg-gray-200 inline-flex items-center justify-center text-[10px] text-gray-500" />
                          )}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-xs">{row.file.name}</td>
                        <td className="py-2 px-2.5 font-mono text-xs">{row.sku ?? '—'}</td>
                        <td className="py-2 px-2.5">
                          <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 text-green-700 bg-green-50">
                            {mode === 'replace' ? __uiText("แทนที่แล้ว") : __uiText("เพิ่มแล้ว")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {doneRows.length > visibleCount && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((v) => v + VISIBLE_ROWS_STEP)}
                    className="text-xs text-blue-600 font-semibold self-start"
                  >
                    {__uiText("…อีก ")}{doneRows.length - visibleCount} {__uiText(" รายการ")}</button>
                )}
              </>
            )}

            <div className="mt-2">
              <button
                type="button"
                onClick={startNewBatch}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 bg-white text-gray-700"
              >
                {allFailed ? __uiText("เลือกไฟล์ใหม่") : __uiText("อัปโหลดชุดใหม่")}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-3 mt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-gray-900">{__uiText("ประวัติการอัปโหลด")}</h2>
          <button
            type="button"
            onClick={runPrune}
            disabled={pruning}
            title={__uiText("ลบรูปเก่าที่ถูกแทนที่ซ้ำจนกู้คืนไม่ได้แล้วออกจาก S3 — แต่ละช่องรูปเก็บรูปก่อนหน้าไว้ 1 ภาพเสมอ")}
            className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
          >
            {pruning ? __uiText("กำลังล้าง…") : __uiText("ล้างรูปเก่าที่กู้คืนไม่ได้แล้ว")}
          </button>
        </div>
        {historyIsError && (
          <div className="flex items-center justify-between rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
            <span>{__uiText("โหลดประวัติไม่สำเร็จ")}</span>
            <button type="button" onClick={() => refetchHistory()} className="font-semibold underline">
              {__uiText("ลองใหม่")}</button>
          </div>
        )}
        {historyLoading && <div className="text-sm text-gray-500">{__uiText("กำลังโหลด…")}</div>}
        <Table
          columns={historyColumns}
          data={historyRows}
          idKey="logId"
          currentPage={historyResponse?.page ?? historyPage}
          totalItems={historyResponse?.total ?? 0}
          totalPages={
            Math.ceil((historyResponse?.total ?? 0) / (historyResponse?.limit ?? HISTORY_LIMIT)) || 1
          }
          onPageChange={setHistoryPage}
        />
      </div>
    </div>
  );
};

export default BulkImageUploadPage;

import { uiText as __uiText } from '@cp/ui';
export type BulkUploadFailReason =
  | 'invalid_filename'
  | 'sku_not_found'
  | 'file_too_large'
  | 'unsupported_type'
  /** replace mode only — no `_<n>` in the filename, so no slot to replace */
  | 'missing_sequence'
  /** client-only: two staged files claim the same SKU + slot. The server can't
   *  see this (it only ever gets one 10-file batch), so it is caught here. */
  | 'duplicate_slot'
  | 'upload_failed';

/** `append` grows a SKU's gallery; `replace` overwrites the slot in the filename. */
export type BulkUploadMode = 'append' | 'replace';

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

export type StagedFileInfo = { name: string; type: string; size: number };

export type StagedClassification = {
  sku: string | null;
  sequence: number | null;
  status: 'ready' | 'rejected';
  reason?: BulkUploadFailReason;
};

/**
 * Parses a filename into its SKU and 1-based gallery slot: strips the
 * extension, then a trailing `_<digits>`. Splits on the LAST underscore only,
 * so SKUs containing `-` or `.` survive intact.
 * Mirrors apps/backend/src/app/product/sku-image-filename.helper.ts
 * (parseSkuFromFilename) exactly — keep both in sync if either changes.
 */
export function parseSkuFromFilename(
  originalName: string,
): { sku: string; sequence: number | null } | null {
  const trimmed = originalName.trim();
  if (!trimmed) return null;

  const lastDotIndex = trimmed.lastIndexOf('.');
  const basename = lastDotIndex === -1 ? trimmed : trimmed.slice(0, lastDotIndex);
  if (!basename) return null;

  const lastUnderscoreIndex = basename.lastIndexOf('_');
  if (lastUnderscoreIndex !== -1) {
    const suffix = basename.slice(lastUnderscoreIndex + 1);
    if (/^\d+$/.test(suffix)) {
      const sku = basename.slice(0, lastUnderscoreIndex);
      if (!sku) return null;
      return { sku, sequence: Number(suffix) };
    }
  }

  return { sku: basename, sequence: null };
}

function extOf(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

function classifyOne(
  file: StagedFileInfo,
  mode: BulkUploadMode,
): StagedClassification {
  const ext = extOf(file.name);
  const typeOk = ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(ext);
  if (!typeOk) {
    return { sku: null, sequence: null, status: 'rejected', reason: 'unsupported_type' };
  }
  const parsed = parseSkuFromFilename(file.name);
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      sku: parsed?.sku ?? null,
      sequence: parsed?.sequence ?? null,
      status: 'rejected',
      reason: 'file_too_large',
    };
  }
  if (!parsed) {
    return { sku: null, sequence: null, status: 'rejected', reason: 'invalid_filename' };
  }
  // Replace aims at the slot in the filename — without `_<n>` there is nothing
  // to aim at, so the file is rejected here instead of guessing slot 1.
  if (mode === 'replace' && parsed.sequence === null) {
    return { sku: parsed.sku, sequence: null, status: 'rejected', reason: 'missing_sequence' };
  }
  return { sku: parsed.sku, sequence: parsed.sequence, status: 'ready' };
}

/**
 * Classifies the whole staged set at once — "two files claim the same slot" is
 * only visible across files, and only matters in replace mode where the second
 * one would silently overwrite the first. First file for a slot wins.
 * Returns one classification per input, in the same order.
 */
export function classifyStagedFiles(
  files: StagedFileInfo[],
  mode: BulkUploadMode,
): StagedClassification[] {
  const results = files.map((file) => classifyOne(file, mode));
  if (mode !== 'replace') return results;

  const claimedSlots = new Set<string>();
  return results.map((result) => {
    if (result.status !== 'ready' || result.sku === null || result.sequence === null) {
      return result;
    }
    const slotKey = `${result.sku.toLowerCase()}_${result.sequence}`;
    if (claimedSlots.has(slotKey)) {
      return { ...result, status: 'rejected' as const, reason: 'duplicate_slot' as const };
    }
    claimedSlots.add(slotKey);
    return result;
  });
}

/** Thai label for every failure reason the backend (or client-side classification) can return. */
export const FAIL_REASON_TH: Record<BulkUploadFailReason, string> = {
  invalid_filename: 'อ่าน SKU จากชื่อไฟล์ไม่ได้ — เปลี่ยนชื่อเป็น sku_ลำดับ.jpg เช่น JG001_1.jpg',
  sku_not_found: 'ไม่พบ SKU นี้ในระบบ — ตรวจสอบรหัสสินค้าแล้วเปลี่ยนชื่อไฟล์',
  file_too_large: 'ไฟล์ใหญ่เกิน 5 MB — ย่อไฟล์แล้วลองใหม่',
  unsupported_type: 'ชนิดไฟล์ไม่รองรับ (รองรับเฉพาะ jpg, jpeg, png, gif, webp)',
  missing_sequence: 'โหมดแทนที่ต้องระบุลำดับรูปในชื่อไฟล์ — เปลี่ยนเป็น sku_ลำดับ.jpg เช่น JG001_1.jpg',
  duplicate_slot: 'มีไฟล์อื่นในชุดนี้แทนที่รูปลำดับเดียวกันอยู่แล้ว — เก็บไว้ไฟล์เดียวต่อ 1 ลำดับ',
  upload_failed: 'อัปโหลดขัดข้อง — กด “ลองอีกครั้ง” ได้เลย',
};

/** Thai label for one `BulkUploadLogItem.status` value (`'ok'` or a BulkUploadFailReason string). */
export function bulkUploadLogStatusLabel(status: string): string {
  if (status === 'ok') return __uiText("สำเร็จ");
  return FAIL_REASON_TH[status as BulkUploadFailReason] ?? status;
}

export type BulkUploadAppended = { filename: string; sku: string };
export type BulkUploadFailed = { filename: string; reason: BulkUploadFailReason };
export type BatchRowResult = { status: 'done' | 'failed'; reason?: BulkUploadFailReason };

/** Last path segment only — folder drops can put a relative path in File.name. */
export function fileBasename(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

/**
 * Axios envelope is `{ data: { status, data: { appended, failed } } }`.
 * Other callers sometimes already unwrap one layer — accept both.
 */
export function extractBulkUploadResult(response: unknown): {
  appended: BulkUploadAppended[];
  failed: BulkUploadFailed[];
} {
  const root = response as Record<string, unknown> | null | undefined;
  const envelope = (root?.data ?? root) as Record<string, unknown> | undefined;
  const payload = (envelope?.data ?? envelope) as Record<string, unknown> | undefined;
  return {
    appended: Array.isArray(payload?.appended) ? (payload.appended as BulkUploadAppended[]) : [],
    failed: Array.isArray(payload?.failed) ? (payload.failed as BulkUploadFailed[]) : [],
  };
}

/**
 * Correlate one HTTP batch's results back to staged rows.
 *
 * Must run *outside* a React setState updater: the queues are shifted as we
 * walk the batch, and React Strict Mode (dev) invokes updaters twice. Doing
 * the shift inside `setRows` consumes the queues on the first call, so the
 * second call marks every successful file as `upload_failed`.
 */
export function matchBatchResults(
  batch: Array<{ key: string; fileName: string }>,
  appended: BulkUploadAppended[],
  failed: BulkUploadFailed[],
): Map<string, BatchRowResult> {
  const appendedQueueByName = new Map<string, BulkUploadAppended[]>();
  appended.forEach((item) => {
    const name = fileBasename(item.filename);
    const list = appendedQueueByName.get(name) ?? [];
    list.push(item);
    appendedQueueByName.set(name, list);
  });

  const failedQueueByName = new Map<string, BulkUploadFailed[]>();
  failed.forEach((item) => {
    const name = fileBasename(item.filename);
    const list = failedQueueByName.get(name) ?? [];
    list.push(item);
    failedQueueByName.set(name, list);
  });

  const results = new Map<string, BatchRowResult>();
  batch.forEach((row) => {
    const name = fileBasename(row.fileName);
    const appendedQueue = appendedQueueByName.get(name);
    if (appendedQueue && appendedQueue.length > 0) {
      appendedQueue.shift();
      results.set(row.key, { status: 'done' });
      return;
    }
    const failedQueue = failedQueueByName.get(name);
    const failure = failedQueue && failedQueue.length > 0 ? failedQueue.shift() : undefined;
    results.set(row.key, {
      status: 'failed',
      reason: failure?.reason ?? 'upload_failed',
    });
  });
  return results;
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data

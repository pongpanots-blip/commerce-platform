import React from 'react';
import { AiOutlineArrowUp, AiOutlineArrowDown } from "react-icons/ai";

export interface TableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: any, row: T) => React.ReactNode;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  sortKey?: string;
  sortOrder?: 'ASC' | 'DESC';
  onSort?: (key: string) => void;

  // สำหรับระบบ Pagination (ไม่ส่ง onPageChange = ซ่อนแถบ pagination)
  currentPage?: number;
  totalPages?: number;
  totalItems?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;

  // สำหรับระบบเลือกแถว (Checkbox)
  selectedIds?: number[] | string[];
  onSelectRow?: (id: any) => void;
  onSelectAll?: () => void;
  idKey?: keyof T;

  // จำกัดความสูงของพื้นที่แถว (thead+tbody) แล้วให้ scroll ในตัว โดย pagination bar ยังอยู่นิ่งด้านล่าง
  // เสมอ — ไม่ส่ง = พฤติกรรมเดิมทุกประการ (ไม่ scroll, ไม่ sticky header)
  // ตัวอย่าง: bodyMaxHeightClassName="max-h-[28rem]"
  bodyMaxHeightClassName?: string;
}

export function Table<T>({
  columns,
  data,
  sortKey,
  sortOrder,
  onSort,
  currentPage = 1,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  selectedIds = [],
  onSelectRow,
  onSelectAll,
  idKey = 'id' as keyof T,
  bodyMaxHeightClassName,
}: TableProps<T>) {

  const safeData = Array.isArray(data) ? data : [];
  const enablePagination = typeof onPageChange === 'function';
  const safeTotalItems = totalItems ?? safeData.length;
  const safePageSize = pageSize ?? (safeData.length || 10);
  const computedTotalPages = Math.max(1, Math.ceil(safeTotalItems / safePageSize));
  const safeTotalPages = Math.max(1, totalPages ?? computedTotalPages);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), safeTotalPages);

  const isAllSelected = safeData.length > 0 && safeData.every(row =>
    (selectedIds as any[]).includes(row[idKey])
  );

  const hasCheckbox = !!(onSelectAll || onSelectRow);
  const totalColumnsCount = (columns?.length || 0) + (hasCheckbox ? 1 : 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div
        className={`overflow-x-auto ${bodyMaxHeightClassName ? `${bodyMaxHeightClassName} overflow-y-auto` : ''}`}
      >
        <table className="w-full text-left border-collapse">
          <thead
            className={`bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 ${bodyMaxHeightClassName ? 'sticky top-0 z-10' : ''}`}
          >
            <tr>
              {hasCheckbox && (
                <th className="p-4 w-12 text-center">
                  {onSelectAll && (
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={onSelectAll}
                      aria-label="เลือกทั้งหมด"
                      className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                    />
                  )}
                </th>
              )}
              {(columns || []).map((col) => (
                <th
                  key={col.key}
                  className={`p-4 ${col.sortable ? 'cursor-pointer hover:bg-gray-100 select-none' : ''}`}
                  onClick={() => col.sortable && onSort && onSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <span className="text-primary">{sortOrder === 'ASC' ? <AiOutlineArrowUp/> : <AiOutlineArrowDown/>}</span>
                    )}
                    {col.sortable && sortKey !== col.key && (
                      <span className="text-gray-300 flex"><AiOutlineArrowUp/><AiOutlineArrowDown/></span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
            {safeData.length === 0 ? (
              <tr>
                <td colSpan={totalColumnsCount} className="p-8 text-center text-gray-400">
                  ไม่พบข้อมูลในระบบ
                </td>
              </tr>
            ) : (
              safeData.map((row, rowIndex) => {
                const rowId = row[idKey];
                const isSelected = (selectedIds as any[]).includes(rowId);

                return (
                  <tr
                    key={rowId ? String(rowId) : rowIndex}
                    className={`hover:bg-gray-50/70 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                  >
                    {hasCheckbox && (
                      <td className="p-4 text-center">
                        {onSelectRow && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onSelectRow(rowId)}
                            aria-label={`เลือกแถว ${rowId}`}
                            className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                          />
                        )}
                      </td>
                    )}
                    {(columns || []).map((col) => {
                      const cellValue = (row as any)[col.key];
                      return (
                        <td key={col.key} className="p-4 align-middle">
                          {col.render ? col.render(cellValue, row) : cellValue ?? '-'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {enablePagination && (
        <div className="bg-white px-4 py-3.5 border-t border-gray-200 flex flex-col sm:flex-row gap-3 items-center justify-between text-sm">
          <div className="text-gray-500 flex flex-wrap items-center gap-2">
            <span>
              หน้า <span className="font-semibold text-gray-700">{safeCurrentPage}</span> จาก{' '}
              <span className="font-semibold text-gray-700">{safeTotalPages}</span> หน้า
            </span>
            <span className="text-gray-300">|</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md font-medium">
              ทั้งหมด {safeTotalItems.toLocaleString()} รายการ
            </span>
            {pageSize ? (
              <>
                <span className="text-gray-300">|</span>
                <span className="text-xs text-gray-500">{pageSize} รายการ/หน้า</span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {safeTotalPages > 1 && (
              <div className="flex items-center gap-1.5 text-gray-600">
                <label htmlFor="page-select" className="text-xs font-medium">
                  ไปที่หน้า:
                </label>
                <select
                  id="page-select"
                  value={safeCurrentPage}
                  onChange={(e) => onPageChange?.(Number(e.target.value))}
                  className="bg-white border border-gray-200 rounded-lg text-sm px-2 py-1 text-gray-700 focus:outline-none focus:border-primary cursor-pointer font-medium"
                >
                  {Array.from({ length: safeTotalPages }, (_, index) => {
                    const pageNum = index + 1;
                    return (
                      <option key={pageNum} value={pageNum}>
                        {pageNum}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPageChange?.(safeCurrentPage - 1)}
                disabled={safeCurrentPage <= 1}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
              >
                ก่อนหน้า
              </button>
              <button
                type="button"
                onClick={() => onPageChange?.(safeCurrentPage + 1)}
                disabled={safeCurrentPage >= safeTotalPages}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
              >
                ถัดไป
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
import React, { useEffect, useRef } from 'react';
import {
  PaginationControls,
  TableEmpty,
  TableViewport,
  uiText,
  useUiLocale,
} from '@cp/ui';
import { AiOutlineArrowUp, AiOutlineArrowDown } from 'react-icons/ai';

export interface TableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  render?: (value: any, row: T) => React.ReactNode;
}

type MobileSelection = {
  selected: boolean;
  onSelect?: () => void;
  disabled: boolean;
};
interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  sortKey?: string;
  sortOrder?: 'ASC' | 'DESC';
  onSort?: (key: string) => void;
  currentPage?: number;
  totalPages?: number;
  totalItems?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  selectedIds?: number[] | string[];
  onSelectRow?: (id: any) => void;
  onSelectAll?: () => void;
  isRowSelectable?: (row: T) => boolean;
  idKey?: keyof T;
  bodyMaxHeightClassName?: string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  renderMobileRow?: (row: T, selection: MobileSelection) => React.ReactNode;
  /** Column keys to leave out (column chooser / saved views). */
  hiddenKeys?: string[];
}

function Checkbox({
  checked,
  mixed,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  mixed?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      aria-checked={mixed ? 'mixed' : checked}
      disabled={disabled}
    />
  );
}

export function Table<T>({
  columns: allColumns,
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
  isRowSelectable,
  idKey = 'id' as keyof T,
  bodyMaxHeightClassName,
  loading = false,
  emptyTitle = 'ยังไม่มีรายการ',
  emptyDescription,
  renderMobileRow,
  hiddenKeys,
}: TableProps<T>) {
  useUiLocale();
  const columns = hiddenKeys?.length ? allColumns.filter((c) => !hiddenKeys.includes(c.key)) : allColumns;
  const safeData = Array.isArray(data) ? data : [];
  const selectable = safeData.filter(
    (row) => !isRowSelectable || isRowSelectable(row),
  );
  const selected = (id: unknown) => (selectedIds as unknown[]).includes(id);
  const allSelected =
    selectable.length > 0 && selectable.every((row) => selected(row[idKey]));
  const someSelected =
    !allSelected && selectable.some((row) => selected(row[idKey]));
  const hasCheckbox = !!(onSelectAll || onSelectRow);
  const count = Number(totalItems ?? safeData.length);
  const safeTotal = Number.isFinite(count) && count >= 0 ? count : 0;
  const computedPages = Math.max(
    1,
    Math.ceil(safeTotal / (pageSize || safeData.length || 10)),
  );
  const suppliedPages = Number(totalPages);
  const pages = Math.max(
    1,
    Math.ceil(
      Number.isFinite(suppliedPages) && suppliedPages > 0
        ? suppliedPages
        : computedPages,
    ),
  );
  const page = Math.min(
    Math.max(1, Number.isFinite(currentPage) ? Math.floor(currentPage) : 1),
    pages,
  );
  const colSpan = Math.max(1, columns.length + (hasCheckbox ? 1 : 0));
  const align = (col: TableColumn<T>) =>
    col.align === 'right'
      ? 'text-right'
      : col.align === 'center'
        ? 'text-center'
        : 'text-left';
  const selectAll = onSelectAll && (
    <Checkbox
      checked={allSelected}
      mixed={someSelected}
      onChange={onSelectAll}
      label={uiText('เลือกทั้งหมดในหน้านี้')}
      disabled={loading || selectable.length === 0}
    />
  );
  return (
    <div className="cp-record-table" aria-busy={loading || undefined}>
      {loading && (
        <span role="status" className="sr-only">
          {uiText('กำลังโหลดรายการ…')}
        </span>
      )}
      {renderMobileRow && (
        <div className="cp-table-mobile-only">
          {hasCheckbox && onSelectAll && (
            <div className="cp-mobile-select-all">
              <label>
                {selectAll}
                <span>{uiText('เลือกทั้งหมดในหน้านี้')}</span>
              </label>
              <span>
                {safeTotal.toLocaleString()} {uiText('รายการ')}
              </span>
            </div>
          )}
          {loading ? (
            <div className="cp-table-empty">
              <div className="cp-table-skeleton w-full" />
              {uiText('กำลังโหลดรายการ…')}
            </div>
          ) : safeData.length === 0 ? (
            <TableEmpty title={emptyTitle}>{emptyDescription}</TableEmpty>
          ) : (
            <div className="cp-mobile-records">
              {safeData.map((row, i) => (
                <div key={row[idKey] != null ? String(row[idKey]) : i}>
                  {renderMobileRow(row, {
                    selected: selected(row[idKey]),
                    onSelect: onSelectRow
                      ? () => onSelectRow(row[idKey])
                      : undefined,
                    disabled:
                      loading || !!(isRowSelectable && !isRowSelectable(row)),
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className={renderMobileRow ? 'cp-table-desktop-only' : undefined}>
        <TableViewport className={bodyMaxHeightClassName}>
          <table className="cp-data-table">
            <thead
              className={
                bodyMaxHeightClassName ? 'sticky top-0 z-10' : undefined
              }
            >
              <tr>
                {hasCheckbox && (
                  <th scope="col" className="w-12 text-center">
                    {selectAll}
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={`${align(col)} ${col.className ?? ''}`}
                    aria-sort={
                      col.sortable && sortKey === col.key
                        ? sortOrder === 'ASC'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {col.sortable && onSort ? (
                      <button
                        type="button"
                        className="cp-table-sort"
                        disabled={loading}
                        onClick={() => onSort(col.key)}
                      >
                        {uiText(col.label)}
                        {sortKey === col.key ? (
                          sortOrder === 'ASC' ? (
                            <AiOutlineArrowUp />
                          ) : (
                            <AiOutlineArrowDown />
                          )
                        ) : (
                          <span
                            className="cp-table-sort-neutral"
                            aria-hidden="true"
                          >
                            ↕
                          </span>
                        )}
                      </button>
                    ) : (
                      uiText(col.label)
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }, (_, n) => (
                  <tr key={n} aria-hidden="true">
                    {Array.from({ length: colSpan }, (_, i) => (
                      <td key={i}>
                        <div className="cp-table-skeleton" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : safeData.length === 0 ? (
                <tr>
                  <td colSpan={colSpan}>
                    <TableEmpty title={emptyTitle}>
                      {emptyDescription}
                    </TableEmpty>
                  </td>
                </tr>
              ) : (
                safeData.map((row, i) => (
                  <tr
                    key={row[idKey] != null ? String(row[idKey]) : i}
                    data-selected={selected(row[idKey]) || undefined}
                  >
                    {hasCheckbox && (
                      <td className="text-center">
                        {onSelectRow && (
                          <Checkbox
                            checked={selected(row[idKey])}
                            onChange={() => onSelectRow(row[idKey])}
                            label={uiText('เลือกแถว {0}', { 0: row[idKey] })}
                            disabled={
                              loading ||
                              !!(isRowSelectable && !isRowSelectable(row))
                            }
                          />
                        )}
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`${align(col)} ${col.className ?? ''}`}
                      >
                        {col.render
                          ? col.render((row as any)[col.key], row)
                          : ((row as any)[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableViewport>
      </div>
      {onPageChange && (
        <div className="cp-table-footer">
          <div className="cp-table-footer-summary">
            <span>{uiText('หน้า {0} จาก {1}', { 0: page, 1: pages })}</span>
            <span aria-hidden="true">·</span>
            <span>
              {uiText('ทั้งหมด')} <strong>{safeTotal.toLocaleString()}</strong>{' '}
              {uiText('รายการ')}
            </span>
            {pageSize && (
              <span>
                · {pageSize} {uiText('รายการ/หน้า')}
              </span>
            )}
          </div>
          <PaginationControls
            page={page}
            pages={pages}
            onPage={onPageChange}
            disabled={loading}
          />
        </div>
      )}
    </div>
  );
}

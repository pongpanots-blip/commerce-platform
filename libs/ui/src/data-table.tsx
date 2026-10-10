import {
  CSSProperties,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { uiText, useUiLocale } from './i18n';

/** One keyboard-accessible scroll surface for native, inherited and embedded tables. */
export function TableViewport({
  children,
  className = '',
  style,
  label,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  useUiLocale();
  const ref = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [overflow, setOverflow] = useState(false);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0,
      mounted = true;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!mounted) return;
        const horizontal = node.scrollWidth > node.clientWidth + 1;
        setOverflow(horizontal);
        setScrollable(horizontal || node.scrollHeight > node.clientHeight + 1);
      });
    };
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    resize?.observe(node);
    if (node.firstElementChild) resize?.observe(node.firstElementChild);
    window.addEventListener('resize', measure);
    const mutation = new MutationObserver(measure);
    mutation.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    void document.fonts?.ready.then(measure);
    measure();
    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener('resize', measure);
      mutation.disconnect();
    };
  }, [children]);
  return (
    <div className="cp-table-viewport">
      <div
        ref={ref}
        className={`cp-table-scroll ${className}`}
        style={style}
        role={scrollable ? 'region' : undefined}
        tabIndex={scrollable ? 0 : undefined}
        aria-label={scrollable ? (label ?? uiText('ตารางข้อมูล')) : undefined}
        aria-describedby={overflow ? hintId : undefined}
      >
        {children}
      </div>
      {overflow && (
        <div id={hintId} className="cp-table-scroll-hint">
          <span aria-hidden="true">↔</span>
          {uiText('เลื่อนซ้าย–ขวาเพื่อดูคอลัมน์ทั้งหมด')}
        </div>
      )}
    </div>
  );
}

export function TableEmpty({
  title = 'ยังไม่มีรายการ',
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  useUiLocale();
  return (
    <div className="cp-table-empty">
      <span className="cp-table-empty-icon" aria-hidden="true">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M3 10h18M9 10v10" />
        </svg>
      </span>
      <p className="cp-table-empty-title">{uiText(title)}</p>
      {children && <div className="cp-table-empty-description">{children}</div>}
    </div>
  );
}

function pagesAround(page: number, pages: number): (number | '…')[] {
  const selected =
    pages <= 7
      ? Array.from({ length: pages }, (_, i) => i + 1)
      : [
          ...new Set(
            [1, page - 1, page, page + 1, pages].filter(
              (p) => p >= 1 && p <= pages,
            ),
          ),
        ].sort((a, b) => a - b);
  const result: (number | '…')[] = [];
  for (const p of selected) {
    if (result.length && p - Number(result[result.length - 1]) > 1)
      result.push('…');
    result.push(p);
  }
  return result;
}

/** Numbered desktop navigation and a bounded page jump on phones, using the same callback. */
export function PaginationControls({
  page,
  pages,
  onPage,
  disabled = false,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  useUiLocale();
  const jumpInput = useRef<HTMLInputElement>(null);
  const total = Math.max(1, Math.floor(Number.isFinite(pages) ? pages : 1));
  const current = Math.min(
    Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)),
    total,
  );
  const jump = () => {
    const input = jumpInput.current;
    if (!input || !input.checkValidity() || disabled) return;
    const next = input.valueAsNumber;
    if (Number.isInteger(next) && next >= 1 && next <= total) onPage(next);
  };
  return (
    <nav className="cp-pagination" aria-label={uiText('เปลี่ยนหน้าตาราง')}>
      <button
        type="button"
        className="cp-pagination-arrow"
        aria-label={uiText('ก่อนหน้า')}
        disabled={disabled || current <= 1}
        onClick={() => onPage(current - 1)}
      >
        ‹
      </button>
      <div className="cp-pagination-pages">
        {pagesAround(current, total).map((p, i) =>
          p === '…' ? (
            <span className="cp-pagination-gap" key={`gap-${i}`}>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className="cp-pagination-page"
              aria-current={p === current ? 'page' : undefined}
              aria-label={uiText('หน้า {0}', { 0: p })}
              disabled={disabled}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
      </div>
      {total > 1 && (
        <div className="cp-pagination-jump">
          <label>
            <span className="cp-pagination-jump-label">
              {uiText('ไปที่หน้า:')}
            </span>
            <input
              ref={jumpInput}
              key={current}
              type="number"
              inputMode="numeric"
              min={1}
              max={total}
              required
              defaultValue={current}
              disabled={disabled}
              aria-label={uiText('ไปที่หน้า:')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  jump();
                }
              }}
            />
          </label>
          <span className="cp-pagination-total">
            / {total.toLocaleString()}
          </span>
          <button
            type="button"
            disabled={disabled}
            className="cp-pagination-arrow"
            aria-label={uiText('ไปที่หน้าที่ระบุ')}
            onClick={jump}
          >
            →
          </button>
        </div>
      )}
      <button
        type="button"
        className="cp-pagination-arrow"
        aria-label={uiText('ถัดไป')}
        disabled={disabled || current >= total}
        onClick={() => onPage(current + 1)}
      >
        ›
      </button>
    </nav>
  );
}

/** Download rows as an Excel-friendly CSV (UTF-8 BOM, every cell quoted). `columns` picks and orders the fields. */
export function downloadCsv<T extends Record<string, unknown>>(rows: T[], columns: { key: string; label?: string }[], filename: string) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => esc(c.label ?? c.key)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

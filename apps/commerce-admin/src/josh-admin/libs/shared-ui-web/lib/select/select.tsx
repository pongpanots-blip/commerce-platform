import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaChevronCircleDown } from 'react-icons/fa';

// กำหนดโครงสร้างข้อมูลสำหรับออปชันแต่ละตัวที่ต้องส่งเข้ามา
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** อาเรย์ของตัวเลือก — ใส่ได้เมื่อไม่ได้ส่ง children (เช่น <optgroup> ของ CategorySelect) มาเอง */
  data?: SelectOption[];
  placeholder?: string;    // ข้อความเริ่มต้น (ถ้ามี)
  label?: string;
  hint?: string;
  error?: string;
  children?: ReactNode;
}

/** ตัวเลือกที่แบนแล้ว — ใช้วาดเมนู (group = label ของ <optgroup> ที่ครอบอยู่) */
type FlatOption = { value: string; label: string; disabled?: boolean; group?: string };

/** อ่านตัวเลือกออกมาจาก children (<option>/<optgroup>) เพื่อเอาไปวาดเมนูแบบกำหนดเอง */
function flattenChildren(children: ReactNode): FlatOption[] {
  const out: FlatOption[] = [];
  const walk = (nodes: ReactNode, group?: string) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as {
        value?: string | number;
        label?: string;
        disabled?: boolean;
        hidden?: boolean;
        children?: ReactNode;
      };
      if (child.type === 'optgroup') {
        walk(props.children, props.label);
      } else if (child.type === 'option') {
        // option ที่เป็น placeholder (disabled+hidden) ไม่ต้องโผล่ในเมนู
        if (props.disabled && props.hidden) return;
        const text = React.Children.toArray(props.children).join('');
        out.push({
          // HTML: <option> ที่ไม่มี value ใช้ text content เป็นค่า — ต้องตรงกับ native select ที่ซ่อนไว้
          value: String(props.value ?? text),
          label: text,
          disabled: props.disabled,
          group,
        });
      } else {
        // fragment หรือ wrapper อื่น ๆ — เดินต่อเข้าไปข้างใน
        walk(props.children, group);
      }
    });
  };
  walk(children);
  return out;
}

export function Select({
  data,
  placeholder,
  className = '',
  label,
  hint,
  error,
  id,
  disabled,
  children,
  multiple,
  ...props
}: SelectProps) {
  const locale = __useUiLocale();
  const generatedId = React.useId();
  // ปุ่ม combobox คือ control ที่ผู้ใช้กดจริง — `id` ของ caller จึงต้องลงที่ปุ่ม ไม่ใช่ native select
  // ที่ sr-only+aria-hidden ไม่งั้น <label htmlFor={id}> ที่ caller เขียนเองจะชี้ไปที่ของที่กดไม่ได้
  const buttonId = id ?? generatedId;
  const nativeId = `${buttonId}-native`;

  // props ที่เกี่ยวกับ "ตัวที่ผู้ใช้เห็น/โฟกัส" ต้องไปที่ปุ่ม ส่วน value/name/form semantics ไปที่ native select
  const forButton = (k: string) =>
    k.startsWith('aria-') || k.startsWith('data-') ||
    ['title', 'style', 'tabIndex', 'autoFocus', 'onFocus', 'onBlur'].includes(k);
  const buttonProps = Object.fromEntries(Object.entries(props).filter(([k]) => forButton(k)));
  const nativeProps = Object.fromEntries(Object.entries(props).filter(([k]) => !forButton(k)));

  // className ของ caller ต้องไปอยู่บน "กล่องนอกสุด" ไม่ใช่บนปุ่ม — ปุ่มมี `w-full` ติดมาเสมอ และ Tailwind
  // ตัดสินด้วยลำดับใน stylesheet ไม่ใช่ลำดับใน attribute ถ้าเอา `w-24` ไปต่อท้าย `w-full` บนปุ่ม
  // `w-full` จะชนะทุกครั้ง คลาสความกว้างที่ caller ส่งมาจึงตายเงียบ
  const setsWidth = /(?:^|\s)(?:w-|flex-1|flex-auto|grow|basis-)/.test(className);
  const outerClass = [setsWidth ? '' : 'w-full', className].filter(Boolean).join(' ');

  const nativeRef = useRef<HTMLSelectElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  // เมนู render ผ่าน portal ไปที่ body แล้ววางด้วย position:fixed — ไม่งั้นโดน parent ที่ overflow ตัด
  // (เคสจริง: Select ในเซลล์ของ <Table> ซึ่งห่อด้วย overflow-hidden + overflow-x-auto)
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    maxWidth?: number;
    top?: number;
    bottom?: number;
  }>({ left: 0, width: 0 });
  const [activeIndex, setActiveIndex] = useState(-1);
  // ใช้เฉพาะตอนที่ caller ไม่ได้คุม value เอง (uncontrolled / defaultValue) — controlled อ่านจาก props ตรง ๆ
  const [uncontrolled, setUncontrolled] = useState<string[] | null>(null);

  const options = useMemo<FlatOption[]>(
    () =>
      children
        ? flattenChildren(children)
        : (data ?? []).map((o) => ({
            value: String(o.value),
            label: o.label,
            disabled: o.disabled,
          })),
    [children, data, locale],
  );

  // ค่าที่ถูกเลือกอยู่ — อ่านจาก props เพราะ native select ยังเป็นเจ้าของ state เหมือนเดิม
  const selected = useMemo(() => {
    if (props.value === undefined && uncontrolled) return uncontrolled;
    const raw = props.value ?? props.defaultValue;
    if (raw === undefined || raw === null) return [];
    return (Array.isArray(raw) ? raw : [raw]).map(String);
  }, [props.value, props.defaultValue, uncontrolled]);

  const triggerText = options
    .filter((o) => selected.includes(o.value))
    .map((o) => o.label)
    .join(', ');

  /**
   * ส่งค่ากลับผ่าน native <select> ที่ซ่อนไว้ แล้วยิง change event จริง
   * — caller เดิมทุกตัวจึงยังรับ e.target.value ได้เหมือน <select> ปกติ ไม่ต้องแก้สักไฟล์
   */
  const commit = (value: string) => {
    const el = nativeRef.current;
    if (!el) return;
    if (multiple) {
      const next = selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value];
      Array.from(el.options).forEach((o) => {
        o.selected = next.includes(o.value);
      });
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    setUncontrolled(Array.from(el.selectedOptions).map((o) => o.value));
    if (!multiple) setOpen(false);
  };

  /** วางเมนูให้ตรงกับปุ่ม — ponytail: คำนวณจาก rect ตรง ๆ ไม่ต้องมี positioning engine */
  const place = () => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    const dropUp = r.bottom + 240 > window.innerHeight && r.top > 240;
    setPos({
      left: r.left,
      width: r.width,
      maxWidth: window.innerWidth - r.left - 8,
      ...(dropUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  };

  const openMenu = () => {
    if (disabled) return;
    place();
    setActiveIndex(options.findIndex((o) => selected.includes(o.value)));
    setOpen(true);
  };

  // คลิกนอกกล่อง = ปิดเมนู
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // เมนูอยู่นอก rootRef แล้ว (portal) — ถ้าไม่เช็ค menuRef ด้วย เมนูจะปิดก่อน onClick ของ item จะยิง
      if (!rootRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    // เมนูเป็น position:fixed จึงต้องขยับตามเวลาหน้า/คอนเทนเนอร์สกรอลล์ (capture = จับ scroll ของ div ด้วย)
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const move = (step: number) => {
    if (!options.length) return;
    let i = activeIndex;
    for (let n = 0; n < options.length; n++) {
      i = (i + step + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActiveIndex(i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false);
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt && !opt.disabled) commit(opt.value);
    } else if (e.key === 'Tab') setOpen(false);
  };

  const field = (
    <div
      className={`relative ${label || hint || error ? "w-full" : outerClass}`}
      ref={rootRef}
    >
      {/* native select ที่ซ่อนไว้ — ยังเป็นเจ้าของ value/name/form semantics
       * aria-hidden เพราะ widget จริงที่ผู้ใช้/screen reader ใช้คือปุ่ม combobox ข้างล่าง
       * (ถ้าไม่ซ่อน จะมี combobox/option ซ้อนกันสองชุดใน accessibility tree) */}
      <select
        ref={nativeRef}
        id={nativeId}
        disabled={disabled}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        {...nativeProps}
      >
        {placeholder && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {children ??
          data?.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
      </select>

      {/* ปุ่มที่ผู้ใช้เห็น — กล่องเดียวกับ Basic Input, chevron-circle 20px ขวา (Figma 71:20011)
       * ponytail: border-2 คงที่ตลอด (เหมือน Input/Textarea) กันความสูงกระโดดตอนโฟกัส */}
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${buttonId}-listbox` : undefined}
        id={buttonId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        {...buttonProps}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={[props['aria-describedby'], (error || hint) && `${buttonId}-message`].filter(Boolean).join(' ') || undefined}
        className={`
          flex h-10 w-full items-center rounded-lg border bg-white py-2 pl-3 pr-8 text-left text-sm
          transition-colors cursor-pointer focus:outline-none
          ${triggerText ? 'text-ink' : 'text-ink-muted'}
          ${error
            ? 'border-alert'
            : 'border-gray-200 hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/10'}
          disabled:cursor-not-allowed disabled:border-surface-disabled disabled:bg-surface-disabled disabled:text-ink-disabled
        `}
      >
        <span className="truncate">{triggerText || (placeholder ? __uiText(placeholder) : ' ')}</span>
      </button>

      {/* chevron-circle ฝั่งขวา */}
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-ink-muted">
        <FaChevronCircleDown size={20} />
      </div>

      {/* เมนู (Figma "Navigation / Dropdown" 145:8254) — panel ขาว p-8 radius-8 shadow level-1,
       * item สูง 40 hover primary-soft / selected primary-border + S6, scrollbar 4px */}
      {open && createPortal(
        <ul
          ref={menuRef}
          id={`${buttonId}-listbox`}
          role="listbox"
          aria-multiselectable={multiple || undefined}
          // ponytail: min-width เท่าปุ่ม แล้วปล่อยให้ยืดตามตัวเลือกยาวสุด — native select ก็ auto-size
          // แบบนี้ ถ้าล็อก width เท่าปุ่ม ตัวเลือกยาว ๆ จะโดน ellipsis จนแยกกันไม่ออก
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            minWidth: pos.width,
            maxWidth: Math.max(pos.width, pos.maxWidth ?? pos.width),
            width: 'max-content',
          }}
          className="z-50 max-h-[236px] overflow-y-auto rounded-lg bg-white p-2 shadow-level-1
            [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink-secondary/40
            [&::-webkit-scrollbar-track]:bg-surface-disabled [&::-webkit-scrollbar]:w-1"
        >
          {options.length === 0 && (
            // Figma "State=Not Found" — ponytail: ข้อความอย่างเดียว ไม่มี illustration 64px (ยังไม่มี asset)
            <li className="py-4 text-center text-sm text-ink-secondary">{__uiText("No Results Found")}</li>
          )}
          {options.map((option, i) => {
            const isSelected = selected.includes(option.value);
            const showGroup = !!option.group && option.group !== options[i - 1]?.group;
            return (
              <React.Fragment key={i}>
                {showGroup && (
                  <li role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold text-ink-muted">
                    {option.group}
                  </li>
                )}
                <li
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => !option.disabled && commit(option.value)}
                  className={`flex h-10 items-center gap-2 rounded-lg px-3 text-sm
                    ${option.disabled
                      ? 'cursor-not-allowed text-ink-disabled'
                      : isSelected
                        ? 'cursor-pointer bg-primary-border font-semibold text-ink'
                        : `cursor-pointer text-ink ${i === activeIndex ? 'bg-primary-soft' : ''}`}`}
                >
                  {multiple && (
                    <input
                      type="checkbox"
                      readOnly
                      checked={isSelected}
                      disabled={option.disabled}
                      tabIndex={-1}
                      className="pointer-events-none h-6 w-6 shrink-0 accent-primary"
                    />
                  )}
                  <span className="truncate">{option.label}</span>
                </li>
              </React.Fragment>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );

  if (!label && !hint && !error) {
    return field;
  }

  return (
    <div className={outerClass}>
      {label && (
        <label
          htmlFor={buttonId}
          className="mb-1 block text-sm text-ink-secondary"
        >
          {__uiText(label)}
        </label>
      )}
      {field}
      {error ? (
        <p id={`${buttonId}-message`} className="mt-1 text-sm text-alert">{__uiText(error)}</p>
      ) : (
        hint && <p id={`${buttonId}-message`} className="mt-1 text-xs text-ink-muted">{__uiText(hint)}</p>
      )}
    </div>
  );
}

export default Select;

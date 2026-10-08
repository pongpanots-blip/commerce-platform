// ui-metadata-migration: static labels and UI notices only
import { compareCategoryOrder, getProductCategories } from '@josh/shared-api';
import { Select } from '@josh/shared-ui-web';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import React from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export type CategoryRow = {
  category_id_uuid: string;
  parent_id_uuid?: string | null;
  category_code?: string | null;
  cat_code?: string | null;
  category_name_en?: string | null;
  category_name_th?: string | null;
  category_path?: string | null;
  category_level?: number | null;
  category_image?: string | null;
  sort_order?: number | null;
  show_on_homepage?: boolean;
  is_active?: boolean;
};

/**
 * ชื่อชั้นตามข้อมูลจริงใน `product_category` (ดู docs/categories-api.md)
 * — ไม่ใช่ 1-4 แบบที่ฟอร์มเดิมเดาไว้
 */
export const LEVEL_LABELS: Record<number, string> = {
  get 0(){return __uiText("Division — หมวดบนสุด (FRESHFOOD / DRYFOOD / NONFOOD)");},
  get 1(){return __uiText("Category High Level — แถวไอคอนบนหน้าแรก");},
  get 2(){return __uiText("Sub Category Level 2");},
  get 3(){return __uiText("Sub Category Level 3 — ชั้นที่ผูกสินค้า");},
};

export function levelLabel(level: number): string {
  return __uiText("Level {0} · {1}",{"0":level,"1":LEVEL_LABELS[level] ?? __uiText("ชั้นย่อย")});
}

/**
 * หมวดปลายกิ่ง — หมวดที่ไม่มีลูก
 * สินค้าผูกกับหมวดแบบนี้เสมอ (ปัจจุบัน 5,889 SKU อยู่บน leaf 152 หมวด ไม่มีตัวไหนแขวนบนหมวดที่มีลูก)
 */
export function leafCategories(rows: CategoryRow[]): CategoryRow[] {
  const hasChildren = new Set(
    rows.map((row) => row.parent_id_uuid).filter((id): id is string => Boolean(id)),
  );
  return rows.filter((row) => !hasChildren.has(row.category_id_uuid));
}

/**
 * แยก path เป็นหัวข้อกลุ่มกับชื่อที่เหลือ เพื่อไม่ต้องอ่าน path เต็มซ้ำทุกบรรทัด
 * `FRESHFOOD > BAKERY > BAKING INGREDIENT > BREADMIX`
 *   → group `FRESHFOOD > BAKERY` · label `BAKING INGREDIENT > BREADMIX`
 */
export function splitPath(path: string | null | undefined, groupDepth = 2) {
  const parts = (path ?? '').split(' > ').filter(Boolean);
  return {
    group: parts.slice(0, groupDepth).join(' > ') || '—',
    label: parts.slice(groupDepth).join(' > ') || parts[parts.length - 1] || '—',
  };
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  __useUiLocale();
  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-secondary">{__uiText(label)}</span>
        {children}
      </label>
      {hint && <p className="mt-1 text-xs text-ink-muted">{__uiText(hint)}</p>}
    </div>
  );
}

/**
 * ดึงหมวดทั้งหมดจาก API ครั้งเดียว (`GET /product-category` คืนสูงสุด 500 แถว)
 * ส่ง `with_active_products_only=false` เพราะ admin ต้องเห็นหมวดที่ยังไม่มีสินค้า active
 * ด้วย — ค่า default ของ API กรองทิ้งเพื่อหน้าร้าน หมวดพวกนั้นเลยหายไปจากทุก dropdown
 * ในหน้า admin ทั้งที่ยังต้องแก้ชื่อ/รูป/ลำดับได้
 */
export async function fetchCategoryRows(): Promise<CategoryRow[]> {
  try {
    const res: any = await getProductCategories(true, 'en');
    return res?.data?.data ?? [];
  } catch {
    return [];
  }
}

/**
 * คีย์เดียวของ "หมวดทั้งต้นไม้" ทุกหน้าที่ต้องใช้ต้นไม้นี้ใช้คีย์นี้ร่วมกัน
 * แก้อะไรที่กระทบต้นไม้ (สร้าง / ลบ / เปลี่ยนชื่อ / จัดลำดับ) ให้ invalidate คีย์นี้
 */
export const CATEGORY_ROWS_QUERY_KEY = ['product-category', 'tree'] as const;

/**
 * reference คงที่ตอนยังไม่มีข้อมูล
 *
 * `data ?? []` แบบ inline ที่ call site สร้างอาเรย์ใหม่ทุก render — ระหว่างที่ query ยังโหลด
 * (`data` เป็น `undefined`) `useMemo` ที่ผูกกับ rows จะ recompute ทุกรอบ แล้ว `useEffect` ที่
 * sync ค่าจากมันจะ `setState` ทุกรอบ กลายเป็น render loop ที่หยุดเมื่อ query ตอบกลับมาเท่านั้น
 * hook จึงคืน `rows` ที่ default ไว้แล้ว ไม่ปล่อยให้ call site ทำเอง
 */
const NO_ROWS: CategoryRow[] = [];

/**
 * ต้นไม้หมวดหมู่ทั้งชุดผ่าน react-query
 *
 * ก่อนหน้านี้แต่ละหน้า (`CategoryList` / `CreateCategory` / `CreateProduct`) ยิง
 * `GET /product-category?with_active_products_only=false` (สูงสุด 500 แถว) เองด้วย `useEffect`
 * ดิบ ๆ ผลคือยิงซ้ำสองรอบทุกครั้งที่ mount เพราะ `<StrictMode>` และยิงใหม่ทั้งชุดทุกครั้งที่
 * สลับหน้าไป-กลับ react-query dedupe คำขอที่ซ้อนกันให้เอง และ `staleTime` ทำให้การกลับมาหน้าเดิม
 * ใช้แคชแทนการยิงใหม่
 */
export function useCategoryRowsQuery(): UseQueryResult<CategoryRow[]> & {
  rows: CategoryRow[];
} {
  const query = useQuery({
    queryKey: CATEGORY_ROWS_QUERY_KEY,
    queryFn: fetchCategoryRows,
    staleTime: 5 * 60_000,
  });
  return { ...query, rows: query.data ?? NO_ROWS };
}

/** ต้นไม้หมวดหมู่แบบอาเรย์เปล่า — ใช้เมื่อไม่ต้องรู้สถานะโหลด */
export function useCategoryRows(): CategoryRow[] {
  return useCategoryRowsQuery().rows;
}

/**
 * `Select` หมวดหมู่ที่จัดกลุ่มด้วย `<optgroup>` ตามต้นทาง path
 *
 * เรียงด้วย `compareCategoryOrder` (เทียบ `category_code` ทีละ segment) ไม่ใช่ตัวอักษร —
 * ลูกจึงเกาะกลุ่มใต้แม่ และเรียงตาม `sort` ภายในกลุ่มเหมือนที่หน้าร้านเรียง
 *
 * `groupDepth` = จำนวน segment ที่ใช้เป็นหัวข้อกลุ่ม (1 = จัดกลุ่มตาม Division)
 */
export function CategorySelect({
  rows,
  value,
  onChange,
  placeholder = '— เลือกหมวดหมู่ —',
  groupDepth = 2,
}: {
  rows: CategoryRow[];
  value: string;
  onChange: (categoryId: string) => void;
  placeholder?: string;
  groupDepth?: number;
}) {
  __useUiLocale();
  const sorted = [...rows].sort(compareCategoryOrder);
  const groups = [
    ...new Set(sorted.map((row) => splitPath(row.category_path, groupDepth).group)),
  ];

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{__uiText(placeholder)}</option>
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {sorted
            .filter((row) => splitPath(row.category_path, groupDepth).group === group)
            .map((row) => (
              <option key={row.category_id_uuid} value={row.category_id_uuid}>
                {row.category_code ? `${row.category_code} · ` : ''}
                {splitPath(row.category_path, groupDepth).label}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

/**
 * เลือกหมวดให้ "สินค้า" — เห็นเฉพาะหมวดปลายกิ่ง
 * ต่างจาก `CategorySelect` เปล่า ๆ ที่เห็นทุกหมวด (ใช้ตอนเลือกหมวดมาแก้ค่า)
 */
export function LeafCategorySelect({
  rows,
  value,
  onChange,
}: {
  rows: CategoryRow[];
  value: string;
  onChange: (categoryId: string) => void;
}) {
  __useUiLocale();
  return (
    <CategorySelect
      rows={leafCategories(rows)}
      value={value}
      onChange={onChange}
      placeholder={__uiText("— เลือกหมวดหมู่สินค้า —")}
    />
  );
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data

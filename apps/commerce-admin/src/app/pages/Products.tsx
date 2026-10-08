// ui-metadata-migration: static labels and UI notices only
import { StatusChip, RowLink } from '@cp/ui';
import { Product, session } from '../../lib/api';
import { ResourcePage, Column, Field } from '../components/ResourcePage';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const columns: Column<Product>[] = [
  { get label(){return __uiText("SKU");}, render: (r) => <RowLink to={`/products/${r.id}`}>{r.sku}</RowLink> },
  { get label(){return __uiText("ชื่อสินค้า");}, render: (r) => r.name },
  { get label(){return __uiText("สถานะ");}, render: (r) => <StatusChip status={r.status} /> },
];

const fields: Field[] = [
  { name: 'sku', get label(){return __uiText("SKU");}, required: true, placeholder: 'SKU-1' },
  { name: 'name', get label(){return __uiText("ชื่อสินค้า");}, required: true, placeholder: 'ชื่อสินค้าที่ต้องการแสดง' },
  { name: 'description', get label(){return __uiText("รายละเอียด");}, type: 'textarea' },
];

export function Products() {
  __useUiLocale();
  return (
    <ResourcePage<Product>
      title={__uiText("แคตตาล็อกแพลตฟอร์ม")}
      subtitle={__uiText("ดูและจัดการสินค้าในแพลตฟอร์ม ใช้ SKU เพื่อระบุสินค้าแต่ละรายการ")}
      endpoint="/products"
      columns={columns}
      fields={fields}
      createLabel={__uiText("เพิ่มสินค้า")}
      readOnly={['sale', 'graphic'].includes(session.claims()?.role ?? '')}
      searchText={row => `${row.sku} ${row.name}`}
      searchPlaceholder="ค้นหา SKU หรือชื่อสินค้า…"
    />
  );
}

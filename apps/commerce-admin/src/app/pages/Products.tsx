// ui-metadata-migration: static labels and UI notices only
import { StatusChip, RowLink } from '@cp/ui';
import { Product, session } from '../../lib/api';
import { ResourcePage, Column, Field } from '../components/ResourcePage';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const columns: Column<Product>[] = [
  { get label(){return __uiText("รหัสสินค้า");}, render: (r) => <RowLink to={`/products/${r.id}`}>{r.sku}</RowLink> },
  { get label(){return __uiText("ชื่อสินค้า");}, render: (r) => r.name },
  { get label(){return __uiText("สถานะ");}, render: (r) => <StatusChip status={r.status} /> },
];

const fields: Field[] = [
  { name: 'sku', get label(){return __uiText("รหัสสินค้า");}, required: true, placeholder: 'BREAD-001', get hint(){return __uiText("รหัสสั้นที่ใช้ค้นสินค้าในระบบ ลูกค้าเห็นชื่อสินค้า ไม่ใช่รหัสนี้");} },
  { name: 'name', get label(){return __uiText("ชื่อสินค้า");}, required: true, placeholder: 'ขนมปังโฮลวีต', get hint(){return __uiText("ชื่อที่ทีมและลูกค้าอ่านรู้เรื่อง");} },
  { name: 'description', get label(){return __uiText("รายละเอียด");}, type: 'textarea', placeholder: 'ขนมปังโฮลวีต 450 กรัม', get hint(){return __uiText("ไม่บังคับ อธิบายสั้น ๆ ว่าสินค้านี้คืออะไร");} },
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

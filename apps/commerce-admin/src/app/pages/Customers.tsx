// ui-metadata-migration: static labels and UI notices only
import { Stack2, StatusChip, RowLink } from '@cp/ui';
import { Customer } from '../../lib/api';
import { ResourcePage, Column, Field } from '../components/ResourcePage';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const columns: Column<Customer>[] = [
  { get label(){return __uiText("ชื่อลูกค้า");}, render: (r) => <Stack2 top={<RowLink mono={false} to={`/customers/${r.id}`}>{r.name}</RowLink>} bottom={r.code ?? undefined} /> },
  { get label(){return __uiText("อีเมล");}, render: (r) => r.email ?? '—' },
  { get label(){return __uiText("เบอร์โทร");}, render: (r) => r.phone ?? '—' },
  { get label(){return __uiText("สถานะ");}, render: (r) => <StatusChip status={r.status} /> },
];

const fields: Field[] = [
  { name: 'name', get label(){return __uiText("ชื่อลูกค้า");}, required: true, placeholder: 'ร้านอาหารบ้านสวน', get hint(){return __uiText("ชื่อที่ทีมใช้เรียกลูกค้ารายนี้");} },
  { name: 'code', get label(){return __uiText("รหัสลูกค้า");}, placeholder: 'CUST-001', get hint(){return __uiText("ไม่บังคับ ใช้เมื่อต้องการอ้างอิงรหัสเดิม");} },
  { name: 'email', get label(){return __uiText("อีเมล");}, type: 'email', placeholder: 'orders@example.com', get hint(){return __uiText("ไม่บังคับ ใช้ส่งเอกสาร");} },
  { name: 'phone', get label(){return __uiText("เบอร์โทร");}, type: 'tel', placeholder: '0812345678', get hint(){return __uiText("ไม่บังคับ ใส่ตัวเลขโดยไม่ต้องมีขีด");} },
];

export function Customers() {
  __useUiLocale();
  return (
    <ResourcePage<Customer>
      title={__uiText("ลูกค้าแพลตฟอร์ม")}
      subtitle={__uiText("ดูข้อมูลติดต่อและรายละเอียดของลูกค้าในแพลตฟอร์ม")}
      endpoint="/customers"
      columns={columns}
      fields={fields}
      createLabel={__uiText("เพิ่มลูกค้า")}
      searchText={row => `${row.name} ${row.code ?? ''} ${row.email ?? ''} ${row.phone ?? ''}`}
      searchPlaceholder="ชื่อ รหัสลูกค้า อีเมล หรือเบอร์โทร…"
    />
  );
}

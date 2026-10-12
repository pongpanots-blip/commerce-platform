// ui-metadata-migration: static labels and UI notices only
import { Stack2, StatusChip, RowLink } from '@cp/ui';
import { Customer } from '../../lib/api';
import { ResourcePage, Column } from '../components/ResourcePage';
import { customerFields } from './catalog-fields';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const columns: Column<Customer>[] = [
  { get label(){return __uiText("ชื่อลูกค้า");}, render: (r) => <Stack2 top={<RowLink mono={false} to={`/customers/${r.id}`}>{r.name}</RowLink>} bottom={r.code ?? undefined} /> },
  { get label(){return __uiText("อีเมล");}, render: (r) => r.email ?? '—' },
  { get label(){return __uiText("เบอร์โทร");}, render: (r) => r.phone ?? '—' },
  { get label(){return __uiText("สถานะ");}, render: (r) => <StatusChip status={r.status} /> },
];

export function Customers() {
  __useUiLocale();
  return (
    <ResourcePage<Customer>
      title={__uiText("ลูกค้าแพลตฟอร์ม")}
      subtitle={__uiText("ดูข้อมูลติดต่อและรายละเอียดของลูกค้าในแพลตฟอร์ม")}
      endpoint="/customers"
      columns={columns}
      fields={customerFields}
      createLabel={__uiText("เพิ่มลูกค้า")}
      saveLabel={__uiText("บันทึกลูกค้า")}
      searchLabel={__uiText("ค้นหาลูกค้า")}
      searchPlaceholder={__uiText("ชื่อ รหัสลูกค้า อีเมล หรือเบอร์โทร…")}
    />
  );
}

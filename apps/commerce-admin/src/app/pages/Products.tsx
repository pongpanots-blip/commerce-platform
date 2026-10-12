// ui-metadata-migration: static labels and UI notices only
import { StatusChip, RowLink } from '@cp/ui';
import { Product, session } from '../../lib/api';
import { ResourcePage, Column } from '../components/ResourcePage';
import { productFields } from './catalog-fields';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const columns: Column<Product>[] = [
  { get label(){return __uiText("รหัสสินค้า");}, render: (r) => <RowLink to={`/products/${r.id}`}>{r.sku}</RowLink> },
  { get label(){return __uiText("ชื่อสินค้า");}, render: (r) => r.name },
  { get label(){return __uiText("สถานะ");}, render: (r) => <StatusChip status={r.status} /> },
];

export function Products() {
  __useUiLocale();
  return (
    <ResourcePage<Product>
      title={__uiText("ค้นหาสินค้าตามรหัส")}
      subtitle={__uiText("ค้นหาสินค้าทุกรายการด้วยรหัสหรือชื่อ เปิดดูรายละเอียดและสต็อกแต่ละคลัง")}
      endpoint="/products"
      columns={columns}
      fields={productFields}
      createLabel={__uiText("เพิ่มสินค้า")}
      saveLabel={__uiText("บันทึกสินค้า")}
      readOnly={['sale', 'graphic'].includes(session.claims()?.role ?? '')}
      searchLabel={__uiText("ค้นหาสินค้า")}
      searchPlaceholder={__uiText("ค้นหารหัสหรือชื่อสินค้า…")}
    />
  );
}

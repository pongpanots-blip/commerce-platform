import { StatusChip } from '@cp/ui';
import { Product } from '../../lib/api';
import { ResourcePage, Column, Field } from '../components/ResourcePage';

const columns: Column<Product>[] = [
  { label: 'SKU', render: (r) => <span className="font-mono text-[11px]">{r.sku}</span> },
  { label: 'Name', render: (r) => r.name },
  { label: 'Status', render: (r) => <StatusChip status={r.status} /> },
];

const fields: Field[] = [
  { name: 'sku', label: 'SKU', required: true, placeholder: 'SKU-1' },
  { name: 'name', label: 'Name', required: true, placeholder: 'Widget' },
  { name: 'description', label: 'Description' },
];

export function Products() {
  return (
    <ResourcePage<Product>
      title="Products"
      subtitle="Canonical product catalog (SKU unique per org)."
      endpoint="/products"
      columns={columns}
      fields={fields}
      createLabel="Add product"
    />
  );
}

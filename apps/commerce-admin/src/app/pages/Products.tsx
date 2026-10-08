import { StatusChip, RowLink } from '@cp/ui';
import { Product, session } from '../../lib/api';
import { ResourcePage, Column, Field } from '../components/ResourcePage';

const columns: Column<Product>[] = [
  { label: 'SKU', render: (r) => <RowLink to={`/products/${r.id}`}>{r.sku}</RowLink> },
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
      readOnly={session.claims()?.role === 'graphic'}
    />
  );
}

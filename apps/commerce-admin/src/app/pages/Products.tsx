import { Product } from '../../lib/api';
import { ResourcePage, Column, Field } from '../components/ResourcePage';
import { statusBadgeClass } from '../hooks';

const columns: Column<Product>[] = [
  { label: 'SKU', render: (r) => <span className="mono">{r.sku}</span> },
  { label: 'Name', render: (r) => r.name },
  { label: 'Status', render: (r) => <span className={statusBadgeClass(r.status)}>{r.status}</span> },
];

const fields: Field[] = [
  { name: 'sku', label: 'SKU', required: true, placeholder: 'SKU-1' },
  { name: 'name', label: 'Name', required: true, placeholder: 'Widget' },
  { name: 'description', label: 'Description' },
];

export function Products() {
  return (
    <ResourcePage<Product>
      title="Products" subtitle="Canonical product catalog (SKU unique per org)."
      endpoint="/products" columns={columns} fields={fields} createLabel="Add product" />
  );
}

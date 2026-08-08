import { InventoryLevel } from '../../lib/api';
import { ResourcePage, Column, Field } from '../components/ResourcePage';

const columns: Column<InventoryLevel>[] = [
  { label: 'Product', render: (r) => <span className="mono">{r.productId.slice(0, 8)}…</span> },
  { label: 'Warehouse', render: (r) => <span className="mono">{r.warehouseId.slice(0, 8)}…</span> },
  { label: 'Quantity', render: (r) => r.quantity },
  { label: 'Reserved', render: (r) => r.reserved },
];

const fields: Field[] = [
  { name: 'productId', label: 'Product ID (uuid)', required: true, placeholder: 'uuid' },
  { name: 'warehouseId', label: 'Warehouse ID (uuid)', required: true, placeholder: 'uuid' },
  { name: 'quantity', label: 'Quantity', placeholder: '0' },
  { name: 'reserved', label: 'Reserved', placeholder: '0' },
];

export function Inventory() {
  return (
    <ResourcePage<InventoryLevel>
      title="Inventory" subtitle="Stock levels per product / warehouse."
      endpoint="/inventory" columns={columns} fields={fields} createLabel="Add inventory level" />
  );
}

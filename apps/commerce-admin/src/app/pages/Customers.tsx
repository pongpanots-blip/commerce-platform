import { Customer } from '../../lib/api';
import { ResourcePage, Column, Field } from '../components/ResourcePage';
import { statusBadgeClass } from '../hooks';

const columns: Column<Customer>[] = [
  { label: 'Name', render: (r) => r.name },
  { label: 'Code', render: (r) => r.code ?? '—' },
  { label: 'Email', render: (r) => r.email ?? '—' },
  { label: 'Phone', render: (r) => r.phone ?? '—' },
  { label: 'Status', render: (r) => <span className={statusBadgeClass(r.status)}>{r.status}</span> },
];

const fields: Field[] = [
  { name: 'name', label: 'Name', required: true, placeholder: 'Acme Co' },
  { name: 'code', label: 'Code', placeholder: 'C1' },
  { name: 'email', label: 'Email', placeholder: 'billing@acme.test' },
  { name: 'phone', label: 'Phone' },
];

export function Customers() {
  return (
    <ResourcePage<Customer>
      title="Customers" subtitle="Canonical customer records."
      endpoint="/customers" columns={columns} fields={fields} createLabel="Add customer" />
  );
}

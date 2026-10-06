import { useState } from 'react';
import { Stack2, StatusChip, RowLink } from '@cp/ui';
import { Customer } from '../../lib/api';
import { ResourcePage, Column, Field } from '../components/ResourcePage';

const columns: Column<Customer>[] = [
  { label: 'Name', render: (r) => <Stack2 top={<RowLink mono={false} to={`/customers/${r.id}`}>{r.name}</RowLink>} bottom={r.code ?? undefined} /> },
  { label: 'Email', render: (r) => r.email ?? '—' },
  { label: 'Phone', render: (r) => r.phone ?? '—' },
  { label: 'Status', render: (r) => <StatusChip status={r.status} /> },
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
      title="Customers"
      subtitle="Canonical customer records."
      endpoint="/customers"
      columns={columns}
      fields={fields}
      createLabel="Add customer"
    />
  );
}

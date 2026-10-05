import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

/** josh web-admin AdminListHeader (same markup), with a plain button for josh's shared-ui Button. */
export function AdminListHeader({ title, subtitle, createLabel = 'Create New', createPath, children }:
  { title: string; subtitle?: string; createLabel?: string; createPath?: string; children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-16 flex-col gap-3 rounded-lg bg-white px-6 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold leading-7 text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-ink-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {createPath && <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark" onClick={() => navigate(createPath)}>+ {createLabel}</button>}
      </div>
    </div>
  );
}

export default AdminListHeader;

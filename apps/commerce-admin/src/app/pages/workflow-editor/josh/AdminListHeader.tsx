import type { ReactNode } from 'react';
import { ButtonLink, PageHeader, uiText, useUiLocale } from '@cp/ui';

/** josh web-admin AdminListHeader (same markup), with a plain button for josh's shared-ui Button. */
export function AdminListHeader({ title, subtitle, createLabel = 'Create New', createPath, children }:
  { title: string; subtitle?: string; createLabel?: string; createPath?: string; children?: ReactNode }) {
  useUiLocale();
  return <PageHeader title={title} subtitle={subtitle} actions={<>{children}{createPath && <ButtonLink to={createPath} variant="primary" icon="add">{uiText(createLabel)}</ButtonLink>}</>} />;
}

export default AdminListHeader;

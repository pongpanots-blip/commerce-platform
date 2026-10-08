import { ButtonLink, PageHeader, uiText, useUiLocale } from '@cp/ui';
import { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  createLabel?: string;
  createPath?: string;
  children?: ReactNode;
};

export function AdminListHeader({
  title,
  subtitle,
  createLabel = 'Create New',
  createPath,
  children,
}: Props) {
  useUiLocale();
  return <PageHeader title={title} subtitle={subtitle} actions={<>
    {children}
    {createPath && <ButtonLink to={createPath} variant="primary" icon="add">{uiText(createLabel)}</ButtonLink>}
  </>} />;
}

export default AdminListHeader;

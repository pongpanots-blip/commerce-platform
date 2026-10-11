import { ButtonLink, PageHeader, uiText, useUiLocale } from '@cp/ui';
import { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  createLabel?: string;
  createPath?: string;
  /** Detail and form pages: link back to the list. */
  back?: { to: string; label: string };
  children?: ReactNode;
};

export function AdminListHeader({
  title,
  subtitle,
  createLabel = 'Create New',
  createPath,
  back,
  children,
}: Props) {
  useUiLocale();
  return <PageHeader title={title} subtitle={subtitle} back={back} actions={<>
    {children}
    {createPath && <ButtonLink to={createPath} variant="primary" icon="add">{uiText(createLabel)}</ButtonLink>}
  </>} />;
}

export default AdminListHeader;

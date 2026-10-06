import { Button } from '@josh/shared-ui-web';
import { ReactNode } from 'react';
import { AiOutlinePlus } from 'react-icons/ai';
import { useNavigate } from 'react-router-dom';

type Props = {
  title: string;
  subtitle?: string;
  createLabel?: string;
  createPath?: string;
  children?: ReactNode;
};

// Figma "Page / Table" — แถบหัวหน้าเพจ h-64 พื้นขาว px-24 หัวข้อ H6 (20/28 bold) #041A3D
export function AdminListHeader({
  title,
  subtitle,
  createLabel = 'Create New',
  createPath,
  children,
}: Props) {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-16 flex-col gap-3 rounded-lg bg-white px-6 py-4 shadow-level-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold leading-7 text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-ink-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {createPath && (
          <Button
            text={createLabel}
            icon={<AiOutlinePlus size={20} />}
            onClick={() => navigate(createPath)}
          />
        )}
      </div>
    </div>
  );
}

export default AdminListHeader;

import { Button } from '@josh/shared-ui-web';
import React from 'react';
import { useNavigate } from 'react-router-dom';

type AdminInsertLayoutProps = {
  title: string;
  subtitle?: string;
  backPath?: string;
  saving?: boolean;
  /** Header save button text (default `บันทึก`) — set it when the page has other save buttons. */
  saveLabel?: string;
  wide?: boolean;
  onSave: () => void;
  /** Intercepts both the "← กลับ" and "ยกเลิก" buttons (e.g. to show an unsaved-changes
   * confirm dialog) instead of navigating straight to backPath/-1. */
  onBack?: () => void;
  /** Extra controls rendered left of ยกเลิก/บันทึก in the header (e.g. an active switch). */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
};

export function AdminInsertLayout({
  title,
  subtitle,
  backPath,
  saving = false,
  saveLabel = 'บันทึก',
  wide = false,
  onSave,
  onBack,
  headerActions,
  children,
}: AdminInsertLayoutProps) {
  const navigate = useNavigate();
  const handleBack = () => (onBack ? onBack() : backPath ? navigate(backPath) : navigate(-1));

  return (
    <div className={`${wide ? 'max-w-5xl' : 'max-w-3xl'} mx-auto p-4 md:p-6`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <button
            type="button"
            onClick={handleBack}
            className="text-sm text-ink-muted hover:text-ink mb-2"
          >
            ← กลับ
          </button>
          <h1 className="text-xl font-bold leading-7 text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-ink-muted mt-1">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {headerActions}
          <Button variant="secondary" text="ยกเลิก" onClick={handleBack} />
          <Button
            variant="primary"
            text={saving ? 'กำลังบันทึก...' : saveLabel}
            onClick={onSave}
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-level-1 p-6 flex flex-col gap-5">
        {children}
      </div>
    </div>
  );
}

export default AdminInsertLayout;

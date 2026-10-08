import { Button, PageHeader, Panel } from '@cp/ui';
import React from 'react';
import { useNavigate } from 'react-router-dom';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
  __useUiLocale();
  const navigate = useNavigate();
  const handleBack = () => (onBack ? onBack() : backPath ? navigate(backPath) : navigate(-1));

  return (
    <div className={`${wide ? 'max-w-5xl' : 'max-w-3xl'} mx-auto space-y-5 cp-editor-layout`}>
      <Button variant="ghost" icon="arrow_back" onClick={handleBack}>{__uiText("กลับ")}</Button>
      <PageHeader title={title} subtitle={subtitle} actions={headerActions} />
      <Panel className="p-4 md:p-6 flex flex-col gap-5">{children}</Panel>
      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-secondary-container bg-white/95 p-3 shadow-sm backdrop-blur-sm">
        <Button variant="secondary" onClick={handleBack} disabled={saving}>{__uiText("ยกเลิก")}</Button>
        <Button variant="primary" icon="check" onClick={onSave} disabled={saving}>{saving ? __uiText("กำลังบันทึก...") : __uiText(saveLabel)}</Button>
      </div>
    </div>
  );
}

export default AdminInsertLayout;

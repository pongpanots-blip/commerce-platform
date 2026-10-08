import { FormActions, FormSection, PageHeader, Panel, Stepper, scrollToFirstInvalid, useUnsavedChanges } from '@cp/ui';
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, useUiLocale as __useUiLocale } from "@cp/ui";
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
  /** Ordered steps shown above the form. */
  steps?: string[];
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
  steps,
  children,
}: AdminInsertLayoutProps) {
  __useUiLocale();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const requestLeave = useUnsavedChanges(dirty);
  const leave = () => requestLeave(() => (onBack ? onBack() : backPath ? navigate(backPath) : navigate(-1)));
  const save = () => {
    onSave();
    window.setTimeout(() => scrollToFirstInvalid(root.current), 0);
  };

  return (
    <div
      ref={root}
      className={`${wide ? 'max-w-5xl' : 'max-w-3xl'} mx-auto space-y-5 cp-editor-layout`}
      onInput={() => setDirty(true)}
    >
      <button type="button" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary" onClick={() => void leave()}>{__uiText("กลับ")}</button>
      <PageHeader title={title} subtitle={subtitle} actions={headerActions} />
      {steps && steps.length > 0 && <Stepper steps={steps} />}
      <Panel className="p-4 md:p-6">
        <FormSection title="ข้อมูลที่ต้องกรอก" description="ช่องที่มีดอกจันต้องกรอกก่อนบันทึก ช่องที่ไม่มีดอกจันเว้นว่างได้">
          <div className="flex flex-col gap-5">{children}</div>
        </FormSection>
      </Panel>
      <FormActions saveLabel={saveLabel} saving={saving} onSave={save} onCancel={() => void leave()} />
    </div>
  );
}

export default AdminInsertLayout;

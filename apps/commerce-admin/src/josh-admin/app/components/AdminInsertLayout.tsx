import { Button, PageHeader, Panel, Stepper, scrollToFirstInvalid, useUnsavedChanges } from '@cp/ui';
import React, { useEffect, useRef, useState } from 'react';
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
  /** Only a confirmed save may clear the unsaved-changes guard. */
  onSave: () => boolean | Promise<boolean>;
  /** A completed save from a separate confirmation dialog. */
  savedRevision?: number;
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
  savedRevision,
  onBack,
  headerActions,
  steps,
  children,
}: AdminInsertLayoutProps) {
  __useUiLocale();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (savedRevision !== undefined) setDirty(false); }, [savedRevision]);
  const requestLeave = useUnsavedChanges(dirty);
  const leave = () => requestLeave(() => (onBack ? onBack() : backPath ? navigate(backPath) : navigate(-1)));
  const save = () => {
    void Promise.resolve(onSave()).then((result) => {
      window.setTimeout(() => {
        if (root.current?.querySelector('[aria-invalid="true"]')) {
          scrollToFirstInvalid(root.current);
          return;
        }
        if (result === true) setDirty(false);
      }, 0);
    });
  };

  return (
    <div ref={root} className={`${wide ? 'max-w-5xl' : 'max-w-4xl'} w-full min-w-0 space-y-5 cp-editor-layout`} onInput={() => setDirty(true)}>
      <Button variant="ghost" icon="arrow_back" onClick={() => void leave()}>{__uiText("กลับ")}</Button>
      <PageHeader title={title} subtitle={subtitle} actions={headerActions} />
      {steps && steps.length > 0 && <Stepper steps={steps} />}
      <Panel className="p-4 md:p-6 flex flex-col gap-5">{children}</Panel>
      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-secondary-container bg-white/95 p-3 shadow-sm backdrop-blur-sm">
        <Button variant="secondary" onClick={() => void leave()} disabled={saving}>{__uiText("ยกเลิก")}</Button>
        <Button variant="primary" icon="check" onClick={save} disabled={saving}>{saving ? __uiText("กำลังบันทึก...") : __uiText(saveLabel)}</Button>
      </div>
    </div>
  );
}

export default AdminInsertLayout;

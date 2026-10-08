import { Button } from '@josh/shared-ui-web';
import React, { useEffect, useRef } from 'react';
import { AiOutlineCheckCircle, AiOutlineExclamationCircle } from 'react-icons/ai';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Tone = 'primary' | 'danger';

type Props = {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: Tone;
  /** True while the confirmed action is still running (e.g. an in-flight save) — disables both
   * buttons and swaps the confirm label, instead of closing the dialog immediately on click. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const TONE_STYLES: Record<
  Tone,
  { badge: string; icon: React.ReactNode; button: 'primary' | 'alert' }
> = {
  primary: {
    badge: 'bg-primary-soft text-primary',
    icon: <AiOutlineCheckCircle size={22} />,
    button: 'primary',
  },
  danger: {
    badge: 'bg-alert-soft text-alert',
    icon: <AiOutlineExclamationCircle size={22} />,
    button: 'alert',
  },
};

/**
 * Reusable confirm dialog for the coupon edit page (save / leave-without-saving) — native
 * `<dialog>`, no modal component exists elsewhere in this project. Escape/backdrop-click fires
 * the dialog's own `close` event, treated the same as "ยกเลิก" (must not leave a caller's
 * pending action half-confirmed). Generalised from the old CouponDisableConfirmDialog so
 * title/body/tone/confirmLabel are caller-supplied instead of hardcoded to "disable".
 */
export default function CouponConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'ยกเลิก',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  __useUiLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const styles = TONE_STYLES[tone];

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      // Escape fires `cancel` before `close` — swallow it while busy so an in-flight save can't
      // be dismissed out from under itself (onClose/onCancel below would otherwise still run).
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      // Native <dialog> dispatches click with target === the dialog element itself when the
      // click lands on the backdrop (outside the panel below) — clicks inside the panel target
      // that div or its children instead, so this only fires for an actual backdrop click.
      onClick={(event) => {
        if (!busy && event.target === dialogRef.current) onCancel();
      }}
      className="rounded-xl p-0 backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
    >
      <div className="w-[420px] max-w-[90vw] rounded-xl bg-white p-5 shadow-level-1">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${styles.badge}`}
          >
            {styles.icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            <div className="mt-1 text-sm text-ink-muted">{body}</div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" text={cancelLabel} disabled={busy} onClick={onCancel} />
          <Button
            variant={styles.button}
            text={busy ? __uiText("กำลังดำเนินการ...") : confirmLabel}
            disabled={busy}
            onClick={onConfirm}
          />
        </div>
      </div>
    </dialog>
  );
}

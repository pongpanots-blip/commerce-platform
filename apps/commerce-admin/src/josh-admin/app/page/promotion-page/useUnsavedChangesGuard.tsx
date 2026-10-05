import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate, type LinkProps } from 'react-router-dom';
import CouponConfirmDialog from '../coupon/CouponConfirmDialog';

type LeaveGuard = {
  dirty: boolean;
  requestLeave: (go: () => void) => void;
};

/** What `GuardedLink` asks. Outside a guarded page it never intercepts. */
export const LeaveGuardContext = createContext<LeaveGuard>({
  dirty: false,
  requestLeave: (go) => go(),
});

/**
 * Leaving a page with unsaved edits: `beforeunload` covers reload / close tab / typed URL;
 * `requestLeave(go)` is for in-app exits — the back/cancel button and (via `GuardedLink`,
 * given `context` through `LeaveGuardContext`) links inside the page — and runs `go` straight
 * away when clean, otherwise asks first. Sidebar links are not intercepted: the app uses
 * BrowserRouter, which has no route blocker.
 */
export function useUnsavedChangesGuard(dirty: boolean): LeaveGuard & {
  /** Provide as `LeaveGuardContext` value so `GuardedLink` inside the page is covered. */
  context: LeaveGuard;
  dialog: ReactNode;
} {
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const requestLeave = (go: () => void) =>
    dirty ? setPendingLeave(() => go) : go();

  return {
    dirty,
    requestLeave,
    context: { dirty, requestLeave },
    dialog: (
      <CouponConfirmDialog
        open={!!pendingLeave}
        title="ออกโดยไม่บันทึก?"
        body="มีการแก้ไขที่ยังไม่ได้บันทึก — ถ้าออกตอนนี้ส่วนที่แก้จะหายไป"
        confirmLabel="ออกโดยไม่บันทึก"
        cancelLabel="อยู่ต่อ"
        tone="danger"
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => {
          const go = pendingLeave;
          setPendingLeave(null);
          go?.();
        }}
      />
    ),
  };
}

/**
 * A `Link` that asks before leaving while the page has unsaved edits. A click that opens
 * another tab or window (target=_blank, Ctrl/Cmd/Shift/middle click) does not leave this page,
 * so it is never intercepted.
 */
export function GuardedLink({ to, onClick, target, ...rest }: LinkProps) {
  const { dirty, requestLeave } = useContext(LeaveGuardContext);
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      target={target}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        const opensElsewhere =
          target === '_blank' ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0;
        if (!dirty || event.defaultPrevented || opensElsewhere) return;
        event.preventDefault();
        requestLeave(() => navigate(to));
      }}
    />
  );
}

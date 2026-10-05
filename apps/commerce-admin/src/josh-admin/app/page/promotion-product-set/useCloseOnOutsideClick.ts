import { useEffect, useRef } from 'react';

/** ปิด dropdown เมื่อกดนอกกล่อง (หรือกด Esc) — ผูก ref ที่ wrapper ของ dropdown, setOpen มาจาก useState (stable) */
export function useCloseOnOutsideClick<T extends HTMLElement>(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen]);

  return ref;
}

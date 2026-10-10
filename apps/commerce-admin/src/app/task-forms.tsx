import { useEffect, useRef, useState } from 'react';
import { Alert, Button, ErrorText, Hint, uiText, type TaskFieldErrors, type TaskFormMessages } from '@cp/ui';
import { session } from '../lib/api';

// Survive SPA route unmounts: an in-flight promise is not an unknown, completed request.
const outstandingWrites = new Set<string>();
const writeListeners = new Map<string, Set<() => void>>();
function announce(key: string) { writeListeners.get(key)?.forEach(listener => listener()); }

export function taskMessages(success = 'บันทึกแล้ว'): TaskFormMessages {
  return { invalid: count => uiText('แก้ไขข้อมูล {0} ช่องที่ระบุด้านล่าง', { 0: count }), submitting: uiText('กำลังบันทึก…'), loading: uiText('รอข้อมูลที่จำเป็นโหลดเสร็จ แล้วลองอีกครั้ง'), failure: uiText('บันทึกไม่ได้ ลองอีกครั้ง ข้อมูลของคุณยังอยู่'), success: uiText(success) };
}

/** Existing HTTP contracts supply a generic Nest error; only explicit structured fields are mapped. */
export function writeFailure(error: unknown) {
  const value = error as { message?: unknown; details?: { fieldErrors?: unknown }; status?: number } | null;
  const source = value?.details?.fieldErrors;
  const fieldErrors: TaskFieldErrors = source && typeof source === 'object'
    ? Object.fromEntries(Object.entries(source).filter(([, message]) => typeof message === 'string' && message.trim())) as TaskFieldErrors : {};
  return { ok: false as const, fieldErrors, formError: typeof value?.message === 'string' ? value.message : uiText('บันทึกไม่ได้ ลองอีกครั้ง ข้อมูลของคุณยังอยู่') };
}

export class UnconfirmedWrite extends Error {}
export function requireSaved<T>(value: T, valid: (answer: T) => boolean): T {
  if (!value || !valid(value)) throw new UnconfirmedWrite(uiText('ยังยืนยันผลการบันทึกไม่ได้ ตรวจรายการก่อนลองอีกครั้ง'));
  return value;
}

/** Drafts belong to this tab and staff member. Sensitive fields are excluded from storage. */
export function useActionDraft<T extends Record<string, string>>(task: string, defaults: T, exclude: string[] = []) {
  const key = `cp-action-draft:${session.claims()?.sub ?? session.claims()?.email ?? 'staff'}:${task}`;
  const lockKey = task.startsWith('staff:') ? key.replace(/staff:.*$/, 'staff-actions')
    : task.startsWith('stock:') ? key.replace(/stock:.*$/, 'stock-actions')
    : task.startsWith('cs:sample:') ? key.slice(0, key.lastIndexOf(':')) : key;
  const groupKey = `${lockKey}:write-phase`;
  const [outstanding, setOutstanding] = useState(outstandingWrites.has(lockKey));
  useEffect(() => {
    const update = () => setOutstanding(outstandingWrites.has(lockKey));
    const listeners = writeListeners.get(lockKey) ?? new Set<() => void>();
    listeners.add(update); writeListeners.set(lockKey, listeners); update();
    return () => { listeners.delete(update); if (!listeners.size) writeListeners.delete(lockKey); };
  }, [lockKey]);
  function lock() { if (outstandingWrites.has(lockKey)) return false; outstandingWrites.add(lockKey); announce(lockKey); return true; }
  function settle() { outstandingWrites.delete(lockKey); announce(lockKey); }
  const initial = useRef<{ values: T; phase: 'editing' | 'pending' | 'unknown'; recovered: boolean } | null>(null);
  if (!initial.current) {
    let saved: { values?: Record<string, unknown>; phase?: string } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { /* storage is optional */ }
    const values = { ...defaults };
    for (const name of Object.keys(defaults)) if (!exclude.includes(name) && typeof saved?.values?.[name] === 'string') values[name as keyof T] = saved.values[name] as T[keyof T];
    let groupPhase: string | null = null;
    try { groupPhase = sessionStorage.getItem(groupKey); } catch { /* optional */ }
    const phase = saved?.phase === 'pending' || saved?.phase === 'unknown' || groupPhase === 'pending' || groupPhase === 'unknown' || outstandingWrites.has(lockKey) ? 'unknown' : 'editing';
    initial.current = { values, phase, recovered: !!saved };
  }
  const valuesRef = useRef(initial.current.values);
  const phaseRef = useRef(initial.current.phase);
  const mounted = useRef(true);
  const abortCleanup = useRef<(() => void) | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [values, setValues] = useState(initial.current.values);
  const [pending, setPending] = useState(false);
  const [interrupted, setInterrupted] = useState(initial.current.phase === 'unknown');
  const [recovered, setRecovered] = useState(initial.current.recovered);
  function persist() {
    const safe = Object.fromEntries(Object.entries(valuesRef.current).filter(([name]) => !exclude.includes(name)));
    try { sessionStorage.setItem(key, JSON.stringify({ values: safe, phase: phaseRef.current })); } catch { /* private browsing still permits the active flow */ }
  }
  function set(next: T | ((value: T) => T)) {
    valuesRef.current = typeof next === 'function' ? next(valuesRef.current) : next;
    setValues(valuesRef.current); persist();
  }
  function begin(signal?: AbortSignal) {
    if (phaseRef.current !== 'editing' || !lock()) return false;
    phaseRef.current = 'pending'; setPending(true); persist();
    try { sessionStorage.setItem(groupKey, 'pending'); } catch { /* optional */ }
    const interrupted = () => {
      phaseRef.current = 'unknown'; persist();
      try { sessionStorage.setItem(groupKey, 'unknown'); } catch { /* optional */ }
      if (mounted.current) { setPending(false); setInterrupted(true); }
    };
    signal?.addEventListener('abort', interrupted, { once: true });
    abortCleanup.current = () => signal?.removeEventListener('abort', interrupted);
    return true;
  }
  function fail(error: unknown) {
    const status = (error as { status?: number })?.status;
    // Definite client rejection permits correction. Lost responses and 5xx require reconciliation.
    phaseRef.current = typeof status === 'number' && status >= 400 && status < 500 ? 'editing' : 'unknown';
    abortCleanup.current?.(); abortCleanup.current = null;
    if (mounted.current) { setPending(false); setInterrupted(phaseRef.current === 'unknown'); }
    persist();
    try { phaseRef.current === 'unknown' ? sessionStorage.setItem(groupKey, 'unknown') : sessionStorage.removeItem(groupKey); } catch { /* optional */ }
  }
  function clear() {
    abortCleanup.current?.(); abortCleanup.current = null; setPending(false);
    valuesRef.current = { ...defaults }; phaseRef.current = 'editing'; setValues(valuesRef.current); setInterrupted(false); setRecovered(false);
    try { sessionStorage.removeItem(key); sessionStorage.removeItem(groupKey); } catch { /* optional */ }
  }
  function acknowledge() { if (outstandingWrites.has(lockKey)) return; phaseRef.current = 'editing'; setInterrupted(false); persist(); try { sessionStorage.removeItem(groupKey); } catch { /* optional */ } }
  return { values, set, begin, fail, clear, lock, settle, pending, outstanding, interrupted, recovered, acknowledge, dirty: Object.keys(defaults).some(name => values[name] !== defaults[name]), key };
}

/** A successful read is shown as a read; the operator explicitly checks it before another write. */
export function InterruptedAction({ onCheck, onContinue, outstanding = false }: { onCheck: () => Promise<string>; onContinue: () => void; outstanding?: boolean }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function check() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setChecked(null);
    try { const value = await onCheck(); if (mounted.current) setChecked(value); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <Alert tone="warn" title={uiText('ยังยืนยันผลการบันทึกไม่ได้')}>
    <p>{uiText('คำขอก่อนหน้าอาจบันทึกแล้ว ตรวจข้อมูลล่าสุดก่อนลองอีกครั้งเพื่อป้องกันรายการซ้ำ')}</p>
    {outstanding && <Hint>{uiText('คำขอก่อนหน้ายังทำงานอยู่ รอผลก่อนตรวจและลองใหม่')}</Hint>}
    <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => void check()} disabled={busy || outstanding}>{uiText('ตรวจข้อมูลล่าสุด')}</Button><Button onClick={onContinue} disabled={busy || outstanding || checked === null}>{uiText('ตรวจแล้วและต้องการลองใหม่')}</Button></div>
    {checked !== null && <Hint>{checked}</Hint>}<ErrorText error={error} onRetry={() => void check()} />
  </Alert>;
}

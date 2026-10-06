import { useState } from 'react';
import { Alert, Field, FormPanel, Input, Page, PageHeader } from '@cp/ui';
import { session, staffApi } from '../../lib/api';

const MIN = 10;

/** Any staff member changes their own commerce password (the current one is checked by the API). */
export function ChangePassword() {
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setError(null);
    if (form.next.length < MIN) return setError(`รหัสผ่านใหม่อย่างน้อย ${MIN} ตัวอักษร`);
    if (form.next !== form.again) return setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
    if (form.next === form.current) return setError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
    setBusy(true);
    try {
      await staffApi.changeOwnPassword(form.current, form.next);
      setDone(true);
      setForm({ current: '', next: '', again: '' });
    } catch (e) {
      setError(/current password is wrong/.test(String(e)) ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง' : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader title="เปลี่ยนรหัสผ่าน" subtitle={session.claims()?.email} />
      {done && <Alert tone="ok" onClose={() => setDone(false)}>เปลี่ยนรหัสผ่านแล้ว · ครั้งหน้าใช้รหัสใหม่</Alert>}
      <FormPanel title="รหัสผ่านของคุณ" icon="key" cols={1} busy={busy} error={error} submitLabel="เปลี่ยนรหัสผ่าน" onSubmit={save}>
        <Field label="รหัสผ่านปัจจุบัน"><Input type="password" autoComplete="current-password" required value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></Field>
        <Field label="รหัสผ่านใหม่" hint={`อย่างน้อย ${MIN} ตัวอักษร`}><Input type="password" autoComplete="new-password" required value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></Field>
        <Field label="รหัสผ่านใหม่อีกครั้ง"><Input type="password" autoComplete="new-password" required value={form.again} onChange={(e) => setForm({ ...form, again: e.target.value })} /></Field>
      </FormPanel>
    </Page>
  );
}

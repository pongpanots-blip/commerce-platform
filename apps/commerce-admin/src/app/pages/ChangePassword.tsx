import { useState } from 'react';
import { Alert, Button, Field, FormPanel, Input, Page, PageHeader, LanguageSelector } from '@cp/ui';
import { session, staffApi } from '../../lib/api';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const MIN = 10;

/**
 * Any staff member changes their own commerce password (the current one is checked by the API).
 * `forced`: first sign-in after an admin set the password — shown on its own, before the app.
 */
export function ChangePassword({ forced, onDone, onSignOut }: { forced?: boolean; onDone?: () => void; onSignOut?: () => void } = {}) {
  __useUiLocale();
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setError(null);
    if (form.next.length < MIN) { setError(__uiMessage("รหัสผ่านใหม่อย่างน้อย {0} ตัวอักษร", {"0": MIN})); return false; }
    if (form.next !== form.again) { setError(__uiMessage("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน")); return false; }
    if (form.next === form.current) { setError(__uiMessage("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม")); return false; }
    setBusy(true);
    try {
      await staffApi.changeOwnPassword(form.current, form.next);
      setDone(true);
      setForm({ current: '', next: '', again: '' });
      onDone?.();
    } catch (e) {
      setError(/current password is wrong/.test(String(e)) ? __uiMessage("รหัสผ่านปัจจุบันไม่ถูกต้อง") : e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      <PageHeader
        title={forced ? __uiText("ตั้งรหัสผ่านใหม่ก่อนใช้งาน") : __uiText("เปลี่ยนรหัสผ่าน")}
        subtitle={forced ? __uiText("{0} · รหัสผ่านนี้ admin ตั้งให้ ต้องเปลี่ยนเป็นรหัสของคุณเองก่อน", {"0": session.claims()?.email ?? ''}) : session.claims()?.email}
        actions={forced ? <><LanguageSelector />{onSignOut && <Button icon="logout" onClick={onSignOut}>{__uiText("ออกจากระบบ")}</Button>}</> : undefined}
      />
      {done && <Alert tone="ok" onClose={() => setDone(false)}>{__uiText("เปลี่ยนรหัสผ่านแล้ว · ครั้งหน้าใช้รหัสใหม่")}</Alert>}
      <FormPanel title={__uiText("รหัสผ่านของคุณ")} icon="key" cols={1} busy={busy} error={error} submitLabel={__uiText("เปลี่ยนรหัสผ่าน")} onSubmit={save}>
        <Field label={__uiText("รหัสผ่านปัจจุบัน")}><Input type="password" autoComplete="current-password" required value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></Field>
        <Field label={__uiText("รหัสผ่านใหม่")} hint={__uiText("อย่างน้อย {0} ตัวอักษร", {"0": MIN})}><Input type="password" autoComplete="new-password" required value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></Field>
        <Field label={__uiText("รหัสผ่านใหม่อีกครั้ง")}><Input type="password" autoComplete="new-password" required value={form.again} onChange={(e) => setForm({ ...form, again: e.target.value })} /></Field>
      </FormPanel>
    </>
  );
  if (!forced) return <Page>{body}</Page>;
  return (
    <div className="min-h-screen bg-surface-container-low flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-xl space-y-4">{body}</div>
    </div>
  );
}

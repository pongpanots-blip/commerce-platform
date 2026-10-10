// ui-copy-migration: only literal UI copy and notification templates
import { useState } from 'react';
import { Button, Empty, ErrorText, Hint, Input, Panel, PanelHead, Table, TBody, TD, TH, THead, TR, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import { marketingTestersApi } from '../../lib/api';
import { useAsync } from '../hooks';

/** Who may get real test sends (push campaign test, workflow test with "send for real", MCP test tools). */
export function MarketingTestersPanel() {
  __useUiLocale();
  const list = useAsync(() => marketingTestersApi.list(), []);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); setEmail(''); list.reload(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <Panel className="overflow-hidden">
      <PanelHead title={__uiText("Tester (ผู้รับข้อความทดสอบ)")} />
      <div className="px-4 pt-3"><Hint>{__uiText("ส่งทดสอบจริง (แจ้งเตือน / workflow / ผ่าน AI) ได้เฉพาะบัญชีในรายการนี้ · ใส่อีเมลบัญชีลูกค้าทดสอบในแอป")}</Hint></div>
      <ErrorText error={error ?? list.error} />
      <form className="flex gap-2 px-4 py-3" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void act(() => marketingTestersApi.add(email.trim())); }}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={__uiText("อีเมลบัญชีทดสอบ")} className="max-w-sm" />
        <Button type="submit" disabled={busy || !email.trim()}>{__uiText("เพิ่ม tester")}</Button>
      </form>
      {list.data?.length ? (
        <Table>
          <THead><TH>{__uiText("อีเมล")}</TH><TH>{__uiText("ชื่อ")}</TH><TH>{__uiText("เพิ่มโดย")}</TH><TH /></THead>
          <TBody>
            {list.data.map((t) => (
              <TR key={t.userId}>
                <TD kind="mono">{t.email}</TD>
                <TD>{t.name ?? '—'}</TD>
                <TD>{t.addedBy}</TD>
                <TD><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => marketingTestersApi.remove(t.userId))}>{__uiText("ลบ")}</Button></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : list.data && <div className="px-4 py-6"><Empty icon="person">{__uiText("ยังไม่มี tester")}</Empty></div>}
    </Panel>
  );
}

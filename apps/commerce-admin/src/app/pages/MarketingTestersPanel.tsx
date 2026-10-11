// ui-copy-migration: only literal UI copy and notification templates
import { useState } from 'react';
import { Button, Empty, ErrorText, FormField, Hint, Input, Panel, PanelHead, Table, TBody, TD, TH, THead, TR, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
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
      <PanelHead title={__uiText("ผู้รับข้อความทดสอบ")} />
      <div className="px-4 pt-3"><Hint>{__uiText("ส่งข้อความทดสอบจริงได้เฉพาะบัญชีในรายการนี้ ใส่อีเมลของบัญชีลูกค้าทดสอบในแอป")}</Hint></div>
      <ErrorText error={error ?? list.error} />
      <form className="flex items-end gap-2 px-4 py-3" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void act(() => marketingTestersApi.add(email.trim())); }}>
        <FormField label={__uiText("อีเมลบัญชีทดสอบ")} className="w-full max-w-sm">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <Button type="submit" icon="person_add" disabled={busy || !email.trim()}>{__uiText("เพิ่มผู้รับทดสอบ")}</Button>
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
                <TD><Button size="sm" variant="danger-ghost" icon="delete" disabled={busy}
                  onClick={() => { if (window.confirm(__uiText("นำ {0} ออกจากผู้รับข้อความทดสอบ?", { "0": t.email }))) void act(() => marketingTestersApi.remove(t.userId)); }}>{__uiText("ลบ")}</Button></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : list.data && <div className="px-4 py-6"><Empty icon="person">{__uiText("ยังไม่มีผู้รับทดสอบ ใส่อีเมลด้านบนแล้วกดเพิ่ม")}</Empty></div>}
    </Panel>
  );
}

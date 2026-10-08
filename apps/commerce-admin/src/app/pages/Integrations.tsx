import { useState } from 'react';
import { Alert, Button, Chip, CopyValue, Empty, ErrorText, Field, FormPanel, Input, Loading, Modal, Page, PageHeader, Panel, PanelHead, StatusChip, TBody, TD, TH, THead, TR, Table } from '@cp/ui';
import { api, Integration } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function Integrations() {
  __useUiLocale();
  const { data, loading, error, reload } = useAsync(() => api.get<Integration[]>('/integrations'));
  const [form, setForm] = useState({ name: '', type: 'example', slug: '', signingSecret: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);

  const webhookUrl = (i: Integration) => `${api.base}/webhooks/${i.slug ?? i.id}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/integrations', {
        name: form.name,
        type: form.type,
        ...(form.slug ? { slug: form.slug } : {}),
        ...(form.signingSecret ? { signingSecret: form.signingSecret } : {}),
      });
      setForm({ name: '', type: 'example', slug: '', signingSecret: '' });
      setCreating(false);
      setCreated(true);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title={__uiText("การเชื่อมต่อ")}
        subtitle={__uiText("ดูระบบที่เชื่อมต่อและคัดลอก URL สำหรับรับ Webhook")}
        actions={<><Button icon="refresh" variant="secondary" onClick={reload}>{__uiText("รีเฟรช")}</Button><Button icon="add" variant="primary" onClick={() => { setCreating(true); setFormError(null); }}>{__uiText("เพิ่มการเชื่อมต่อ")}</Button></>}
      />

      {created && <Alert tone="ok" onClose={() => setCreated(false)}>{__uiText("เพิ่มการเชื่อมต่อเรียบร้อยแล้ว")}</Alert>}
      {creating && <Modal title={__uiText("เพิ่มการเชื่อมต่อ")} onClose={() => { if (!submitting) setCreating(false); }} width={640}><FormPanel
        title={__uiText("ข้อมูลระบบที่เชื่อมต่อ")}
        description={__uiText("ตั้งชื่อให้ทีมงานจำได้ และระบุประเภทตัวเชื่อมต่อที่ระบบรองรับ")}
        icon="hub"
        cols={2}
        error={formError}
        submitLabel={__uiText("เพิ่มการเชื่อมต่อ")}
        busy={submitting}
        onSubmit={submit}
        onCancel={() => setCreating(false)}
      >
        <Field label={__uiText("ชื่อการเชื่อมต่อ")}>
          <Input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={__uiText("เช่น ระบบร้านค้า")}
          />
        </Field>
        <Field label={__uiText("ประเภทตัวเชื่อมต่อ")} hint={__uiText("ใช้รหัสประเภทที่ระบบรองรับ เช่น example")}>
          <Input
            required
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            placeholder={__uiText("example")}
          />
        </Field>
        <Field label={__uiText("Webhook slug")} hint={__uiText("ไม่บังคับ ระบบกำหนดจากประเภทเมื่อเว้นว่าง")}>
          <Input
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder={__uiText("auto from type")}
          />
        </Field>
        <Field label={__uiText("Signing secret")} hint={__uiText("ไม่บังคับ ใช้ตรวจสอบลายเซ็น HMAC ของ Webhook")}>
          <Input
            type="password"
            autoComplete="new-password"
            value={form.signingSecret}
            onChange={(e) => setForm({ ...form, signingSecret: e.target.value })}
            placeholder={__uiText("for webhook HMAC")}
          />
        </Field>
      </FormPanel></Modal>}

      <Panel>
        <PanelHead title={__uiText("การเชื่อมต่อทั้งหมด")} sub={data && __uiText("{0} รายการ",{'0':data.length.toLocaleString()})} />
        <ErrorText error={error} />
        {loading && !data ? (
          <Loading />
        ) : error && !data ? null : !data?.length ? (
          <Empty icon="hub">{__uiText("ยังไม่มีการเชื่อมต่อ เริ่มต้นด้วยปุ่ม “เพิ่มการเชื่อมต่อ”")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("ชื่อ")}</TH>
              <TH>{__uiText("ประเภท")}</TH>
              <TH>{__uiText("สถานะ")}</TH>
              <TH>{__uiText("ยืนยันลายเซ็น")}</TH>
              <TH>{__uiText("Webhook URL")}</TH>
            </THead>
            <TBody>
              {data.map((i) => (
                <TR key={i.id}>
                  <TD>{i.name}</TD>
                  <TD kind="mono">{i.type}</TD>
                  <TD><StatusChip status={i.status} /></TD>
                  <TD>{i.signingSecret ? <Chip tone="muted">{__uiText("ตั้งค่าแล้ว")}</Chip> : __uiText("ไม่ได้ตั้งค่า")}</TD>
                  <TD>
                    <CopyValue value={webhookUrl(i)} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}

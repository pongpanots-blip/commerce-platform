import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Chip, CopyValue, Empty, ErrorText, Hint, TaskPanelForm, TaskInput, useUnsavedChanges, Loading, Modal, Page, PageHeader, Panel, PanelHead, StatusChip, TBody, TD, TH, THead, TR, Table } from '@cp/ui';
import { api, Integration } from '../../lib/api';
import { useAsync } from '../hooks';
import { InterruptedAction, requireSaved, taskMessages, useActionDraft, writeFailure } from '../task-forms';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function Integrations() {
  __useUiLocale();
  const { data, loading, error, reload } = useAsync(() => api.get<Integration[]>('/integrations'));
  const location = useLocation();
  const navigate = useNavigate();
  const creating = location.pathname === '/integrations/new';
  const draft = useActionDraft('integrations:create', { name: '', type: 'example', slug: '', signingSecret: '' }, ['signingSecret']);
  const form = draft.values;
  useEffect(() => { if (!creating && form.signingSecret) draft.set(current => ({ ...current, signingSecret: '' })); }, [creating]);
  const [created, setCreated] = useState<Integration | null>(null);
  const leave = () => { draft.set(current => ({ ...current, signingSecret: '' })); navigate(`/integrations${location.search}${location.hash}`); };
  useUnsavedChanges(creating && (draft.dirty || draft.pending));
  const close = () => { if (!draft.pending) leave(); };
  const webhookUrl = (i: Integration) => `${api.base}/webhooks/${i.slug ?? i.id}`;
  async function submit(_data: FormData, signal: AbortSignal) {
    if (!draft.begin(signal)) return { ok: false as const, formError: __uiText('ยังยืนยันผลการบันทึกไม่ได้') };
    try {
      const saved = requireSaved(await api.post<Integration>('/integrations', {
        name: form.name, type: form.type,
        ...(form.slug ? { slug: form.slug } : {}),
        ...(form.signingSecret ? { signingSecret: form.signingSecret } : {}),
      }), row => typeof row.id === 'string' && !!row.id.trim());
      return { ok: true as const, receipt: saved };
    } catch (error) { if (!signal.aborted) draft.fail(error); return writeFailure(error); }
    finally { draft.settle(); }
  }
  async function checkLatest() {
    const rows = await api.get<Integration[]>('/integrations');
    if (!Array.isArray(rows)) throw new Error(__uiText('ยังยืนยันผลการบันทึกไม่ได้'));
    const found = rows.filter(row => row.name === form.name && row.type === form.type);
    reload();
    return __uiText('พบการเชื่อมต่อที่ชื่อและประเภทตรงกัน {0} รายการ ตรวจ Webhook URL ก่อนลองใหม่', { 0: found.length });
  }
  return (
    <Page>
      <PageHeader
        title={__uiText("ระบบที่เชื่อมต่อ")}
        subtitle={__uiText("ระบบภายนอกที่เชื่อมกับเราและสถานะการเชื่อมต่อ")}
        actions={<><Button icon="refresh" variant="secondary" onClick={reload}>{__uiText("รีเฟรช")}</Button><Button icon="add" variant="primary" disabled={draft.pending} onClick={() => { setCreated(null); navigate(`/integrations/new${location.search}${location.hash}`); }}>{__uiText("เพิ่มการเชื่อมต่อ")}</Button></>}
      />

      {created && <Alert tone="ok" onClose={() => setCreated(null)}>{__uiText("เพิ่มการเชื่อมต่อเรียบร้อยแล้ว")}</Alert>}
      {creating && <Modal title={__uiText('เพิ่มการเชื่อมต่อ')} onClose={close} width={640}>
        {draft.recovered && !draft.interrupted && <Hint>{__uiText('กู้คืนข้อมูลที่ยังไม่บันทึกแล้ว ตรวจข้อมูลก่อนบันทึก')}</Hint>}
        {draft.recovered && <Hint>{__uiText('Signing secret ไม่ถูกเก็บในแบบร่าง กรุณากรอกใหม่หากจำเป็น')}</Hint>}
        {draft.interrupted && <InterruptedAction onCheck={checkLatest} onContinue={draft.acknowledge} outstanding={draft.outstanding} />}
        <TaskPanelForm title={__uiText('ข้อมูลระบบที่เชื่อมต่อ')} description={__uiText('ตั้งชื่อให้ทีมงานจำได้ และระบุประเภทตัวเชื่อมต่อที่ระบบรองรับ')} icon="hub" cols={2} messages={taskMessages()} submitLabel={__uiText('เพิ่มการเชื่อมต่อ')} disabled={draft.interrupted || draft.outstanding} onSubmit={submit} onCancel={leave}
          validate={() => Object.fromEntries(['name', 'type'].filter(name => !form[name as 'name' | 'type'].trim()).map(name => [name, __uiText('กรอกข้อมูลที่จำเป็น')]))}
          onSuccess={row => { draft.clear(); setCreated(row); navigate(`/integrations${location.search}${location.hash}`); reload(); }}>
          <TaskInput name="name" label={__uiText('ชื่อการเชื่อมต่อ')} required maxLength={128} value={form.name} onChange={e => draft.set(current => ({ ...current, name: e.target.value }))} placeholder={__uiText('เช่น ระบบร้านค้า')} />
          <TaskInput name="type" label={__uiText('ประเภทตัวเชื่อมต่อ')} help={__uiText('ใช้รหัสประเภทที่ระบบรองรับ เช่น example')} required maxLength={64} value={form.type} onChange={e => draft.set(current => ({ ...current, type: e.target.value }))} placeholder="example" />
          <TaskInput name="slug" label={__uiText('Webhook slug')} help={__uiText('ไม่บังคับ ระบบกำหนดจากประเภทเมื่อเว้นว่าง')} maxLength={64} value={form.slug} onChange={e => draft.set(current => ({ ...current, slug: e.target.value }))} placeholder="auto from type" />
          <TaskInput name="signingSecret" label={__uiText('Signing secret')} help={__uiText('ไม่บังคับ ใช้ตรวจสอบลายเซ็น HMAC ของ Webhook')} type="password" autoComplete="new-password" maxLength={255} value={form.signingSecret} onChange={e => draft.set(current => ({ ...current, signingSecret: e.target.value }))} placeholder="for webhook HMAC" />
        </TaskPanelForm>
      </Modal>}

      <Panel>
        <PanelHead title={__uiText("การเชื่อมต่อทั้งหมด")} sub={data && __uiText("{0} รายการ",{'0':data.length.toLocaleString()})} />
        <ErrorText error={error} onRetry={reload} />
        {loading && !data ? (
          <Loading variant="table" />
        ) : error && !data ? null : !data?.length ? (
          <Empty icon="hub">{__uiText("ยังไม่มีการเชื่อมต่อ เริ่มต้นด้วยปุ่ม “เพิ่มการเชื่อมต่อ”")}</Empty>
        ) : (
          <Table scrollLabel={__uiText("รายการทั้งหมด")}>
            <THead>
              <TH>{__uiText("ชื่อ")}</TH>
              <TH>{__uiText("ประเภท")}</TH>
              <TH>{__uiText("สถานะ")}</TH>
              <TH>{__uiText("ยืนยันลายเซ็น")}</TH>
              <TH>{__uiText("ลิงก์รับข้อมูล")}</TH>
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

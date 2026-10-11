// ui-copy-migration: only literal UI copy and notification templates
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Chip, confirmAction, Empty, Field, Input, Loading, Page, PageHeader, Panel, PanelHead, Table, TBody, TD, TH, THead, TR, Textarea,
  uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { DynamicSegmentInput, EventRule } from '@cp/marketing-workflow';
import { dynamicSegmentsApi, eventsApi } from '../../../lib/api';
import { useAsync } from '../../hooks';
import { EventRuleBuilder } from './EventRuleBuilder';
import { describeRule, newEventLeaf } from './rule-helpers';

const errorText = (e: unknown) => {
  const d = (e as { details?: { issues?: string[]; users?: string[]; message?: string } })?.details;
  return [d?.message, ...(d?.issues ?? []), ...(d?.users ?? [])].filter(Boolean).join(' · ') || (e instanceof Error ? e.message : String(e));
};

/** /marketing/dynamic-segments[/:id] — named event rules, evaluated live, for commerce workflows only (spec §11). */
export function DynamicSegmentsPage() {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  return id ? <Editor id={id === 'new' ? null : id} /> : <List />;
}

function List() {
  __useUiLocale();
  const navigate = useNavigate();
  const list = useAsync(() => dynamicSegmentsApi.list(), []);
  const defs = useAsync(() => eventsApi.definitions(), []);
  const names = new Map((defs.data?.definitions ?? []).map((d) => [d.name, d.label]));
  return (
    <Page>
      <PageHeader title={__uiText('กลุ่มลูกค้าตาม event')}
        subtitle={__uiText('คำนวณใหม่ทุกครั้งที่ workflow ใช้ และใช้ได้เฉพาะ workflow ในระบบนี้')}
        actions={<Button variant="primary" icon="add" onClick={() => navigate('/marketing/dynamic-segments/new')}>{__uiText('เพิ่มกลุ่ม')}</Button>} />
      {list.loading && !list.data ? <Loading /> : list.data?.length ? (
        <Panel><Table>
          <THead><TH>{__uiText('ชื่อ')}</TH><TH>{__uiText('เงื่อนไข')}</TH><TH>{__uiText('สถานะ')}</TH></THead>
          <TBody>{list.data.map((s) => (
            <TR key={s.id} onClick={() => navigate(`/marketing/dynamic-segments/${s.id}`)} className="cursor-pointer">
              <TD>{s.name}</TD><TD>{describeRule(s.rule, names)}</TD><TD>{s.issues.length ? <Chip tone="warn" dot>{__uiText('ต้องแก้ {0} จุด', { 0: s.issues.length })}</Chip> : <Chip tone="ok" dot>{__uiText('พร้อมใช้')}</Chip>}</TD>
            </TR>
          ))}</TBody>
        </Table></Panel>
      ) : <Empty>{__uiText('ยังไม่มีกลุ่ม กด "เพิ่มกลุ่ม" เพื่อตั้งเงื่อนไขแรก')}</Empty>}
    </Page>
  );
}

function Editor({ id }: { id: string | null }) {
  __useUiLocale();
  const navigate = useNavigate();
  const defs = useAsync(() => eventsApi.definitions(), []);
  const existing = useAsync(() => (id ? dynamicSegmentsApi.get(id) : Promise.resolve(null)), [id]);
  const [draft, setDraft] = useState<DynamicSegmentInput | null>(null);
  const [preview, setPreview] = useState<{ count: number | null; issues: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (defs.loading || existing.loading) return <Loading />;
  const definitions = defs.data?.definitions ?? [];
  const value: DynamicSegmentInput = draft ?? existing.data ?? { name: '', description: null, rule: { op: 'AND', children: [newEventLeaf(definitions.find((d) => d.status === 'active'))] } };
  const set = (patch: Partial<DynamicSegmentInput>) => { setDraft({ ...value, ...patch }); setPreview(null); };
  const save = async () => {
    setError(null);
    try { const s = id ? await dynamicSegmentsApi.update(id, value) : await dynamicSegmentsApi.create(value); setDraft(null); navigate(`/marketing/dynamic-segments/${s.id}`, { replace: true }); existing.reload(); }
    catch (e) { setError(errorText(e)); }
  };
  const remove = async () => {
    const ok = await confirmAction({ title: __uiText('ลบกลุ่มนี้?'), body: __uiText('workflow ที่ใช้กลุ่มนี้จะหาลูกค้าจากกลุ่มนี้ไม่ได้อีก'), confirmLabel: __uiText('ลบ'), danger: true });
    if (!ok) return;
    setError(null); try { await dynamicSegmentsApi.remove(id!); navigate('/marketing/dynamic-segments'); } catch (e) { setError(errorText(e)); } };
  const issues = preview?.issues ?? existing.data?.issues ?? [];
  return (
    <Page>
      <PageHeader back={{ to: '/marketing/dynamic-segments', label: __uiText('กลุ่มลูกค้าตาม event') }} title={value.name || __uiText('กลุ่มใหม่')}
        actions={<div className="flex gap-2">
          <Button onClick={async () => setPreview(await dynamicSegmentsApi.preview(value.rule).catch((e) => ({ count: null, issues: [errorText(e)] })))}>{__uiText('นับลูกค้าตอนนี้')}</Button>
          {id && <Button variant="danger-ghost" onClick={remove}>{__uiText('ลบ')}</Button>}
        </div>} />
      {error && <Alert tone="danger">{error}</Alert>}
      {issues.length > 0 && <Alert tone="warn">{issues.join(' · ')}</Alert>}
      {preview?.count != null && <Alert tone="info">{__uiText('ตอนนี้มีลูกค้า (ที่ยินยอม) เข้าเงื่อนไข {0} คน', { 0: preview.count })}</Alert>}
      <Panel>
        <PanelHead title={__uiText('ตั้งค่า')} />
        <div className="space-y-3 p-4">
          <Field label={__uiText('ชื่อ')}><Input value={value.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label={__uiText('คำอธิบาย')}><Textarea rows={2} value={value.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} /></Field>
          <Field label={__uiText('เงื่อนไข')}>
            <EventRuleBuilder rule={value.rule} definitions={definitions} allowSegments={false} onChange={(rule: EventRule) => set({ rule })} />
          </Field>
          <p className="text-xs text-on-surface-variant">{(defs.data?.coverage ?? []).map((c) => `${c.platform}: ${new Date(c.collectingSince).toLocaleDateString()}`).join(' · ')
            || __uiText('ยังไม่มี event เข้ามา')} — {__uiText('ช่วงเวลาย้อนก่อนวันที่เริ่มเก็บไม่ได้')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-secondary-container px-4 py-3">
          <Button variant="ghost" onClick={() => navigate('/marketing/dynamic-segments')}>{__uiText('ยกเลิก')}</Button>
          <Button variant="primary" icon="check" onClick={save}>{__uiText('บันทึก')}</Button>
        </div>
      </Panel>
    </Page>
  );
}
